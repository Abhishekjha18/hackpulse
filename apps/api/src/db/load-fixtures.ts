import "dotenv/config";
import "reflect-metadata";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  EVENT_ROLE,
  EVENT_STATUS,
  GALLERY_VISIBILITY,
  JUDGE_ASSIGNMENT_STATUS,
  NORMALIZATION_METHOD,
  SCORE_STATUS,
  SCORING_MODE,
  SUBMISSION_STATUS,
  VOTING_ACCESS,
  VOTING_MODE,
} from "@hackpulse/shared";
import { and, eq } from "drizzle-orm";

import { auth } from "../auth/auth.config";
import {
  computeJudgeStats,
  computeNormalizedRanking,
  groupByJudge,
} from "../judging/normalization-math";
import { generateInviteCode } from "../teams/invite-code";
import { db, pool } from "./client";
import {
  criterionScores,
  eventRoles,
  events,
  judgeAssignments,
  judgeTrackScopes,
  normalizedResults,
  rubricCriteria,
  rubrics,
  scores,
  submissions,
  teamMembers,
  teams,
  tracks,
  user,
} from "./schema";
/**
 * Loads DOGFOOD-SPEC.md's shared fixture data (fixtures.json) into the
 * database on every boot. Every team's portal is meant to hold the same
 * projects, judges, and scores, so a reviewer comparing two portals is
 * comparing the software, not whose test data looks tidier. Idempotent:
 * if the fixture event already exists, this is a no-op.
 *
 * Deliberately separate from account bootstrapping (see
 * auth.config.ts's databaseHooks): a real user's first sign-up still
 * becomes this instance's admin regardless of whether this script has
 * run. This script only ever creates the fixture event, its own
 * dedicated accounts, and nothing else.
 */

interface FixtureFile {
  event: { id: string; name: string; submissions_close: string };
  tracks: { id: string; name: string }[];
  judges: { id: string; name: string; email: string; tracks: string[] }[];
  teams: { id: string; name: string; members: string[] }[];
  projects: {
    id: string;
    team: string;
    track: string;
    title: string;
    summary: string;
    repo_url: string;
    submitted_at: string;
  }[];
  scores: {
    judge: string;
    project: string;
    criteria: { functionality: number; quality: number; innovation: number };
    comment: string;
  }[];
}

// Deliberately simple, not the min-length default — satisfies Better
// Auth's own minPasswordLength (10) while staying easy to type by hand.
const PASSWORD = "dogfood-check-1";

const FIXTURE_EVENT_SLUG = "sample-hack-2026";

// Pinned, not left to Postgres's defaultRandom(): a checker's .dogfood.toml
// points at specific routes once and shouldn't need editing again on every
// fresh boot. Only the [auth] section (real, freshly-signed session
// cookies — see printLoginCookie below) is meant to change per boot; a
// random event/assignment id here would make [routes] go stale too.
const FIXTURE_EVENT_ID = "d06f00d0-0000-4000-8000-000000000000";
const FIXTURE_JUDGE_A_ASSIGNMENT_ID = "d06f00d0-0000-4000-8000-00000000a001";

/** "priya1@example.org" -> "Priya" — fixtures.json gives team rosters as
 * bare emails, never names, so a display name has to be derived from the
 * local part for the one member (the first) who becomes a real account.
 * The rest of each team's roster is deliberately not seeded as its own
 * account: nothing this instance needs from a fixture team depends on its
 * *other* members being able to log in, only its submission and its
 * owner's membership do. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[0-9_].*$/, "");
  return local.charAt(0).toUpperCase() + local.slice(1);
}

async function createUser(
  email: string,
  name: string,
  extra?: { isAdmin?: boolean; canOrganizeEvents?: boolean },
) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  const [created] = await db.select().from(user).where(eq(user.email, email));
  if (extra?.isAdmin || extra?.canOrganizeEvents) {
    await db
      .update(user)
      .set({
        ...(extra.isAdmin ? { isAdmin: true } : {}),
        ...(extra.canOrganizeEvents ? { canOrganizeEvents: true } : {}),
      })
      .where(eq(user.id, created.id));
  }
  return created;
}

async function addJudge(eventId: string, judgeUserId: string, trackIds: string[]) {
  const [role] = await db
    .insert(eventRoles)
    .values({ eventId, userId: judgeUserId, role: EVENT_ROLE.JUDGE })
    .returning();
  if (trackIds.length > 0) {
    await db
      .insert(judgeTrackScopes)
      .values(trackIds.map((trackId) => ({ eventRoleId: role.id, trackId })));
  }
  return role;
}

/** Real, freshly-signed Better Auth session cookies for the four accounts
 * run.py needs (DOGFOOD-SPEC.md File 1/3) — minted the same way a browser
 * sign-in would (auth.api.signInEmail), not a hand-rolled bypass token.
 * These rotate on every fresh reseed, which is expected: .dogfood.toml's
 * own comment says so, and copying what boot just printed is the intended
 * one-minute step, not a workaround. */
async function printLoginCookie(label: string, email: string): Promise<void> {
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const setCookie = headers.getSetCookie()[0] ?? "";
  const cookiePair = setCookie.split(";")[0];
  // eslint-disable-next-line no-console
  console.log(`  ${label.padEnd(12)} Cookie: ${cookiePair}`);
}

/** Per-judge z-score normalization (see JUDGING.md). Uses the very same
 * math as NormalizationService (normalization-math.ts) rather than a copy,
 * so the fixture data's own awkward cases (a judge who scores every project
 * identically) show up correctly in GET .../judging/results and
 * .../normalization-proof from the moment the instance boots, and can never
 * drift from what the running app computes. */
async function recomputeNormalization(rubricId: string): Promise<void> {
  const submitted = await db
    .select({
      rawWeightedScore: scores.rawWeightedScore,
      submissionId: judgeAssignments.submissionId,
      judgeUserId: judgeAssignments.judgeUserId,
    })
    .from(scores)
    .innerJoin(judgeAssignments, eq(judgeAssignments.id, scores.judgeAssignmentId))
    .where(and(eq(scores.rubricId, rubricId), eq(scores.status, SCORE_STATUS.SUBMITTED)));

  const ranked = computeNormalizedRanking(submitted, computeJudgeStats(groupByJudge(submitted)));

  for (const r of ranked) {
    await db.insert(normalizedResults).values({
      submissionId: r.submissionId,
      rubricId,
      method: NORMALIZATION_METHOD.Z_SCORE,
      rawMean: r.rawMean.toString(),
      normalizedMean: r.normalizedMean.toString(),
      rank: r.rank,
    });
  }
}

async function main() {
  const [existing] = await db.select().from(events).where(eq(events.slug, FIXTURE_EVENT_SLUG));
  if (existing) {
    // eslint-disable-next-line no-console
    console.log("Fixture event already loaded — skipping (idempotent).");
    return;
  }

  const fixturePath = path.resolve(__dirname, "../../../../fixtures.json");
  let raw: string;
  try {
    raw = await readFile(fixturePath, "utf-8");
  } catch {
    // eslint-disable-next-line no-console
    console.log(
      `fixtures.json not found at ${fixturePath} — skipping the fixture load. The instance ` +
        "still boots normally; the first account you register becomes its admin.",
    );
    return;
  }
  const fixture = JSON.parse(raw) as FixtureFile;

  // eslint-disable-next-line no-console
  console.log("Loading fixtures.json...");

  const organizer = await createUser("dogfood-organizer@hackpulse.local", "Dogfood Organizer", {
    canOrganizeEvents: true,
  });

  const [event] = await db
    .insert(events)
    .values({
      id: FIXTURE_EVENT_ID,
      slug: FIXTURE_EVENT_SLUG,
      name: fixture.event.name,
      description:
        "Loaded verbatim from the shared fixture data every reviewer's copy of this portal holds.",
      ownerUserId: organizer.id,
      timezone: "UTC",
      registrationOpenAt: new Date("2026-08-05T00:00:00Z"),
      registrationCloseAt: new Date("2026-09-05T00:00:00Z"),
      submissionOpenAt: new Date("2026-09-05T00:00:00Z"),
      // The one date that has to be the fixture's own value, not a
      // computed one: the "closed event refuses submissions" check
      // relies on this already being in the past.
      submissionCloseAt: new Date(fixture.event.submissions_close),
      judgingOpenAt: new Date("2026-09-20T00:00:00Z"),
      judgingCloseAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      status: EVENT_STATUS.JUDGING,
      galleryVisibility: GALLERY_VISIBILITY.OPEN,
      votingMode: VOTING_MODE.DISABLED,
      votingAccess: VOTING_ACCESS.AUTHENTICATED,
      scoringMode: SCORING_MODE.RUBRIC,
      maxTeamSize: 4,
    })
    .returning();
  await db
    .insert(eventRoles)
    .values({ eventId: event.id, userId: organizer.id, role: EVENT_ROLE.ORGANIZER });

  const trackIdMap = new Map<string, string>();
  for (const [i, t] of fixture.tracks.entries()) {
    const [row] = await db
      .insert(tracks)
      .values({ eventId: event.id, name: t.name, description: "", sortOrder: i })
      .returning();
    trackIdMap.set(t.id, row.id);
  }

  const [rubric] = await db
    .insert(rubrics)
    .values({ eventId: event.id, trackId: null, name: "Fixture Rubric", scaleMin: 1, scaleMax: 5 })
    .returning();
  const criteriaRows = await db
    .insert(rubricCriteria)
    .values([
      { rubricId: rubric.id, name: "Functionality", description: "", weight: "0.34", sortOrder: 0 },
      { rubricId: rubric.id, name: "Quality", description: "", weight: "0.33", sortOrder: 1 },
      { rubricId: rubric.id, name: "Innovation", description: "", weight: "0.33", sortOrder: 2 },
    ])
    .returning();
  const criterionIdByName = new Map(criteriaRows.map((c) => [c.name.toLowerCase(), c.id]));

  const teamIdMap = new Map<string, string>();
  for (const t of fixture.teams) {
    const ownerEmail = t.members[0];
    const owner = await createUser(ownerEmail, nameFromEmail(ownerEmail));
    const [team] = await db
      .insert(teams)
      .values({
        eventId: event.id,
        name: t.name,
        ownerUserId: owner.id,
        inviteCode: generateInviteCode(),
      })
      .returning();
    await db.insert(teamMembers).values({ teamId: team.id, userId: owner.id });
    teamIdMap.set(t.id, team.id);
  }

  // A handful of fixture projects can collide on (team, track): HackPulse
  // enforces exactly one submission per team per track at the schema
  // level (FR-TEAM-03), so a genuine duplicate in the fixture data is
  // caught here and skipped rather than crashing the whole load.
  const submissionIdMap = new Map<string, string>();
  for (const p of fixture.projects) {
    const teamId = teamIdMap.get(p.team);
    const trackId = trackIdMap.get(p.track);
    if (!teamId || !trackId) {
      continue;
    }
    try {
      const [submission] = await db
        .insert(submissions)
        .values({
          teamId,
          trackId,
          name: p.title,
          tagline: p.summary,
          description: p.summary,
          repoUrl: p.repo_url,
          status: SUBMISSION_STATUS.SUBMITTED,
          submittedAt: new Date(p.submitted_at),
          updatedAt: new Date(p.submitted_at),
        })
        .returning();
      submissionIdMap.set(p.id, submission.id);
    } catch (err) {
      const pgCode =
        (err as { cause?: { code?: string }; code?: string }).cause?.code ??
        (err as { code?: string }).code;
      if (pgCode === "23505") {
        // eslint-disable-next-line no-console
        console.log(`  ${p.id} ("${p.title}") duplicates an existing team/track — skipped.`);
        continue;
      }
      throw err;
    }
  }

  // Judges are scoped to the union of tracks they actually scored in this
  // fixture, so track scoping stays internally consistent with the
  // assignments/scores below.
  const scoresByJudge = new Map<string, FixtureFile["scores"]>();
  for (const s of fixture.scores) {
    const arr = scoresByJudge.get(s.judge) ?? [];
    arr.push(s);
    scoresByJudge.set(s.judge, arr);
  }

  const judgeIdMap = new Map<string, string>();
  for (const j of fixture.judges) {
    const theirScores = scoresByJudge.get(j.id) ?? [];
    if (theirScores.length === 0) {
      continue;
    }
    const account = await createUser(j.email, j.name);
    judgeIdMap.set(j.id, account.id);

    const scopedTrackIds = new Set<string>();
    for (const s of theirScores) {
      const proj = fixture.projects.find((p) => p.id === s.project);
      const trackId = proj ? trackIdMap.get(proj.track) : undefined;
      if (trackId) {
        scopedTrackIds.add(trackId);
      }
    }
    await addJudge(event.id, account.id, [...scopedTrackIds]);
  }

  for (const s of fixture.scores) {
    const judgeUserId = judgeIdMap.get(s.judge);
    const submissionId = submissionIdMap.get(s.project);
    if (!judgeUserId || !submissionId) {
      continue;
    }
    const [assignment] = await db
      .insert(judgeAssignments)
      .values({
        eventId: event.id,
        judgeUserId,
        submissionId,
        status: JUDGE_ASSIGNMENT_STATUS.COMPLETED,
        assignedByUserId: organizer.id,
      })
      .returning();

    const rawWeighted =
      s.criteria.functionality * 0.34 + s.criteria.quality * 0.33 + s.criteria.innovation * 0.33;
    const [score] = await db
      .insert(scores)
      .values({
        judgeAssignmentId: assignment.id,
        rubricId: rubric.id,
        status: SCORE_STATUS.SUBMITTED,
        rawWeightedScore: rawWeighted.toFixed(3),
        overallFeedback: s.comment || null,
        submittedAt: new Date(),
      })
      .returning();
    await db.insert(criterionScores).values([
      {
        scoreId: score.id,
        rubricCriterionId: criterionIdByName.get("functionality")!,
        value: s.criteria.functionality.toString(),
      },
      {
        scoreId: score.id,
        rubricCriterionId: criterionIdByName.get("quality")!,
        value: s.criteria.quality.toString(),
      },
      {
        scoreId: score.id,
        rubricCriterionId: criterionIdByName.get("innovation")!,
        value: s.criteria.innovation.toString(),
      },
    ]);
  }

  // --- Four dedicated accounts for run.py (DOGFOOD-SPEC.md File 1/3) -----
  // Not reused from the fixture judges/teams above: these give a checker
  // one clean, unambiguous (own-score, peer-score, participant) triple to
  // probe, independent of which fixture judge happened to score which
  // fixture project.
  const checkerJudgeA = await createUser("dogfood-judge-a@hackpulse.local", "Dogfood Judge A");
  const checkerJudgeB = await createUser("dogfood-judge-b@hackpulse.local", "Dogfood Judge B");
  const checkerParticipant = await createUser(
    "dogfood-participant@hackpulse.local",
    "Dogfood Participant",
  );

  const anchorTrackId = trackIdMap.get("trk_04"); // Security — prj_01's and prj_08's track
  const anchorSubmissionId = submissionIdMap.get("prj_01"); // "Glass Signal"
  const otherSubmissionId = submissionIdMap.get("prj_08"); // "North Drift", same track
  if (!anchorTrackId || !anchorSubmissionId || !otherSubmissionId) {
    throw new Error(
      "Expected fixture track/project ids (trk_04, prj_01, prj_08) were not found while " +
        "wiring up the dogfood-judge-a/-b checker accounts.",
    );
  }

  // judge_a: scoped to trk_04, assigned+scored prj_01 at a pinned
  // assignment id — this is the assignment .dogfood.toml's judge_scores
  // and peer_scores routes both point at.
  await addJudge(event.id, checkerJudgeA.id, [anchorTrackId]);
  const [judgeAAssignment] = await db
    .insert(judgeAssignments)
    .values({
      id: FIXTURE_JUDGE_A_ASSIGNMENT_ID,
      eventId: event.id,
      judgeUserId: checkerJudgeA.id,
      submissionId: anchorSubmissionId,
      status: JUDGE_ASSIGNMENT_STATUS.COMPLETED,
      assignedByUserId: organizer.id,
    })
    .returning();
  const [judgeAScore] = await db
    .insert(scores)
    .values({
      judgeAssignmentId: judgeAAssignment.id,
      rubricId: rubric.id,
      status: SCORE_STATUS.SUBMITTED,
      rawWeightedScore: "4.000",
      submittedAt: new Date(),
    })
    .returning();
  await db.insert(criterionScores).values([
    {
      scoreId: judgeAScore.id,
      rubricCriterionId: criterionIdByName.get("functionality")!,
      value: "4",
    },
    { scoreId: judgeAScore.id, rubricCriterionId: criterionIdByName.get("quality")!, value: "4" },
    {
      scoreId: judgeAScore.id,
      rubricCriterionId: criterionIdByName.get("innovation")!,
      value: "4",
    },
  ]);

  // judge_b: scoped to the same track but assigned to a *different*
  // submission — judge_a's assignment above must refuse judge_b (403).
  await addJudge(event.id, checkerJudgeB.id, [anchorTrackId]);
  const [judgeBAssignment] = await db
    .insert(judgeAssignments)
    .values({
      eventId: event.id,
      judgeUserId: checkerJudgeB.id,
      submissionId: otherSubmissionId,
      status: JUDGE_ASSIGNMENT_STATUS.COMPLETED,
      assignedByUserId: organizer.id,
    })
    .returning();
  const [judgeBScore] = await db
    .insert(scores)
    .values({
      judgeAssignmentId: judgeBAssignment.id,
      rubricId: rubric.id,
      status: SCORE_STATUS.SUBMITTED,
      rawWeightedScore: "3.000",
      submittedAt: new Date(),
    })
    .returning();
  await db.insert(criterionScores).values([
    {
      scoreId: judgeBScore.id,
      rubricCriterionId: criterionIdByName.get("functionality")!,
      value: "3",
    },
    { scoreId: judgeBScore.id, rubricCriterionId: criterionIdByName.get("quality")!, value: "3" },
    {
      scoreId: judgeBScore.id,
      rubricCriterionId: criterionIdByName.get("innovation")!,
      value: "3",
    },
  ]);

  // A team with no submission at all: posting one now, after
  // submissionCloseAt has already passed, is what "closed event refuses
  // submissions" exercises — a genuine deadline rejection, not an
  // unrelated validation error that would also happen to be a 4xx.
  const [checkerTeam] = await db
    .insert(teams)
    .values({
      eventId: event.id,
      name: "Dogfood Probe Team",
      ownerUserId: checkerParticipant.id,
      inviteCode: generateInviteCode(),
    })
    .returning();
  await db.insert(teamMembers).values({ teamId: checkerTeam.id, userId: checkerParticipant.id });

  await recomputeNormalization(rubric.id);

  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`  gallery       = "/events/${event.id}/gallery"`);
  // eslint-disable-next-line no-console
  console.log(`  submit        = "/events/${event.id}/submissions"`);
  // eslint-disable-next-line no-console
  console.log(`  judge_scores  = "/judging/scores/${judgeAAssignment.id}"`);
  // eslint-disable-next-line no-console
  console.log(`  peer_scores   = "/judging/scores/${judgeAAssignment.id}"`);
  // eslint-disable-next-line no-console
  console.log(`  csv_export    = "/events/${event.id}/export/scores.csv"`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("Test logins (paste into .dogfood.toml's [auth] section):");
  await printLoginCookie("organizer", "dogfood-organizer@hackpulse.local");
  await printLoginCookie("judge_a", "dogfood-judge-a@hackpulse.local");
  await printLoginCookie("judge_b", "dogfood-judge-b@hackpulse.local");
  await printLoginCookie("participant", "dogfood-participant@hackpulse.local");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    await pool.end();
    process.exit(1);
  });
