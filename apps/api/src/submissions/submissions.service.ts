import { createHash } from "node:crypto";

import type {
  CreateSubmissionInput,
  CurrentUser,
  SetCustomAnswersInput,
  UpdateSubmissionInput,
} from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, isNull, or } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import { RateLimiterService } from "../common/rate-limiter.service";
import type { Database } from "../db/client";
import {
  customAnswers,
  customQuestions,
  events,
  submissionRevisions,
  submissions,
  teamMembers,
  teams,
} from "../db/schema";
import { loadSubmissionWithEvent } from "../db/submission-lookups";
import { DB } from "../db/tokens";
import { WebhooksService } from "../webhooks/webhooks.service";

// FR-ABUSE-02 — a normalized content fingerprint, not a verbatim hash: two
// submissions that differ only in whitespace/casing (a copy-paste with
// trivial edits, the realistic case for scraped or resubmitted content)
// still collide. Deliberately coarse (name+description+repoUrl only, not
// every field) so organizer review focuses on "is this the same project,"
// not "did they change their tagline."
function computeContentHash(fields: {
  name: string;
  description: string;
  repoUrl: string | null;
}): string {
  const normalized = [fields.name, fields.description, fields.repoUrl ?? ""]
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
    .join(" ");
  return createHash("sha256").update(normalized).digest("hex");
}

// FR-ABUSE-02's "thumbnail hash" — submissions only ever store an arbitrary
// external image URL (no upload storage exists in this app), so hashing
// the actual image bytes would mean the backend fetching an
// attacker-controlled URL server-side, a real SSRF surface. Hashing the
// URL string itself needs no network call at all; it catches the common
// case (the same image link copy-pasted or reused across submissions) but
// not "the same image re-uploaded somewhere else" — an honest, narrower
// signal, not a perceptual image hash.
function computeThumbnailHash(thumbnailUrl: string | null): string | null {
  if (!thumbnailUrl) {
    return null;
  }
  return createHash("sha256").update(thumbnailUrl.trim().toLowerCase()).digest("hex");
}

// FR-ABUSE-02's "title/description similarity" — computeContentHash above
// only ever catches byte-identical (post-normalization) resubmissions; two
// descriptions of the same idea in different words hash completely
// differently. Plain word-set Jaccard similarity, no stemming or stopword
// removal: hackathon-scale submission counts (JUDGING.md's own stated
// scale — tens to low hundreds per track) don't need anything more
// sophisticated, and it stays simple enough to explain to an organizer
// asking "why was this flagged."
function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

// Half the vocabulary of two submissions' name+description overlapping is
// a meaningful, not-coincidental signal at typical description lengths —
// a judgment call, not a derived constant, same posture as the
// workplace-conflict correlation threshold in normalization.service.ts.
const SIMILARITY_THRESHOLD = 0.5;

export type DuplicateGroup =
  | { kind: "exact"; key: string; submissions: { id: string; name: string }[] }
  | { kind: "thumbnail"; key: string; submissions: { id: string; name: string }[] }
  | {
      kind: "similar";
      key: string;
      similarity: number;
      submissions: { id: string; name: string }[];
    };

@Injectable()
export class SubmissionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly webhooks: WebhooksService,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  private async findCallerTeam(eventId: string, userId: string) {
    const [row] = await this.db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, userId)));

    if (!row) {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "You must be on a team for this event first" },
      });
    }
    return row.team;
  }

  private async assertCanEdit(submissionId: string, currentUser: CurrentUser) {
    const { submission, team, event } = await loadSubmissionWithEvent(this.db, submissionId);

    const [membership] = await this.db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, currentUser.id)));

    if (!membership && !isEventOrganizer(currentUser, event.id)) {
      throw new NotFoundException();
    }

    return { submission, team, event };
  }

  // The submission window has a start as well as an end — found live,
  // only submissionCloseAt was ever checked, so a team could submit before
  // submissionOpenAt (e.g. during registration, before the organizer meant
  // submissions to begin at all). Checked alongside the existing deadline
  // check at every mutating call site, same FR-ABUSE-04 audit-log pattern.
  // Automatic mode (submissionOpenAt set): the timestamps are the truth.
  // Manual mode (null): submissions are allowed only while status is
  // exactly "submissions_open" — the organizer-driven equivalent.
  private async assertSubmissionWindowOpen(
    event: {
      id: string;
      status: string;
      submissionOpenAt: Date | null;
      submissionCloseAt: Date | null;
    },
    actorUserId: string,
    attemptedAction: string,
    resource: { resourceType: "event" | "submission"; resourceId: string },
  ) {
    if (event.submissionOpenAt === null) {
      if (event.status === "submissions_open") {
        return;
      }
      await this.audit.log({
        eventId: event.id,
        actorUserId,
        action: "submission.deadline_rejected",
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        metadata: { attemptedAction, reason: "not_open" },
      });
      throw new ConflictException({
        error: { code: "SUBMISSIONS_NOT_OPEN", message: "Submissions aren't open right now" },
      });
    }
    const now = new Date();
    if (now >= event.submissionOpenAt && now <= event.submissionCloseAt!) {
      return;
    }
    const code = now < event.submissionOpenAt ? "SUBMISSIONS_NOT_OPEN" : "DEADLINE_PASSED";
    const message =
      now < event.submissionOpenAt
        ? "Submissions haven't opened yet for this event"
        : "The submission deadline has passed";
    await this.audit.log({
      eventId: event.id,
      actorUserId,
      action: "submission.deadline_rejected",
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      metadata: { attemptedAction, reason: now < event.submissionOpenAt ? "not_open" : "closed" },
    });
    throw new ConflictException({ error: { code, message } });
  }

  // FR-SUB-01/02
  async create(eventId: string, input: CreateSubmissionInput, userId: string) {
    const team = await this.findCallerTeam(eventId, userId);

    // Found live: create() had no deadline check at all (unlike
    // update()/submit(), which do) — a team could start a brand-new draft
    // after the submission window closed, or before it opened.
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    await this.assertSubmissionWindowOpen(event, userId, "create", {
      resourceType: "event",
      resourceId: eventId,
    });

    const contentHash = computeContentHash({
      name: input.name,
      description: input.description ?? "",
      repoUrl: input.repoUrl ?? null,
    });

    // One submission per (team, track) is enforced at the DB level
    // (unique(team_id, track_id) — see db/schema/submissions.schema.ts).
    // Found live: violating it surfaced as a raw, unhandled 500 rather than
    // a message a team could act on.
    try {
      const [submission] = await this.db
        .insert(submissions)
        .values({ ...input, teamId: team.id, status: "draft", contentHash })
        .returning();

      return submission;
    } catch (err) {
      // drizzle-orm wraps the driver error in DrizzleQueryError — the real
      // Postgres error (and its `code`) lives at `.cause`, not on the
      // wrapper itself. Found live: checking `err.code` directly never
      // matched, so this catch silently never fired and the raw 500 this
      // was written to prevent kept happening.
      const pgCode =
        (err as { cause?: { code?: string }; code?: string }).cause?.code ??
        (err as { code?: string }).code;
      if (pgCode === "23505") {
        throw new ConflictException({
          error: { code: "CONFLICT", message: "Your team already has a submission for this track" },
        });
      }
      throw err;
    }
  }

  async findOne(submissionId: string, currentUser: CurrentUser | null) {
    const { submission, team, event } = await loadSubmissionWithEvent(this.db, submissionId);

    const isMember =
      !!currentUser &&
      (await this.db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, currentUser.id)))
        .then((rows) => rows.length > 0));
    const isPrivileged = isMember || isEventOrganizer(currentUser, event.id);

    if (submission.status === "draft" && !isPrivileged) {
      // Draft work in progress is never publicly visible, whatever the
      // event's gallery setting is.
      throw new NotFoundException();
    }

    if (submission.status === "submitted" && !isPrivileged) {
      // FR-GAL-03 applies at the individual-submission level too, not just
      // the gallery listing — an unguessable id shouldn't be treated as a
      // visibility control on its own.
      if (event.galleryVisibility === "hidden") {
        throw new NotFoundException();
      }
      if (event.galleryVisibility === "participants_only" && !currentUser) {
        throw new NotFoundException();
      }
    }

    // Found live: contentHash is a duplicate-detection fingerprint for
    // findDuplicates() (organizer-only, FR-ABUSE-02) — it was leaking to
    // every viewer, including an anonymous gallery visitor, because this
    // just returned the raw row. Not itself reversible to plaintext, but
    // it has no reason to be public and stripping it costs nothing.
    if (!isPrivileged) {
      const { contentHash: _contentHash, ...rest } = submission;
      return rest;
    }

    return submission;
  }

  // FR-SUB-02/03 — the deadline is the real gate, not the submit click:
  // editing a submitted project before the deadline reverts it to draft
  // (clearing submittedAt) rather than being blocked outright, so "submit"
  // stays a deliberate, explicit re-lock action and a judge is never
  // looking at a half-edited entry (assignment/algorithmic eligibility
  // only ever considers status: "submitted" — see
  // assignments.service.ts#createAlgorithmic). Only the deadline itself
  // is rejected server-side, per the client clock never being trusted.
  async update(submissionId: string, input: UpdateSubmissionInput, currentUser: CurrentUser) {
    const { submission, event } = await this.assertCanEdit(submissionId, currentUser);

    await this.assertSubmissionWindowOpen(event, currentUser.id, "edit", {
      resourceType: "submission",
      resourceId: submissionId,
    });

    if (!this.rateLimiter.consume("submission-edit", currentUser.id, 60_000, 20)) {
      throw new HttpException(
        { error: { code: "RATE_LIMITED", message: "Too many edits, please slow down" } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const wasSubmitted = submission.status === "submitted";

    const needsRehash =
      input.name !== undefined || input.description !== undefined || input.repoUrl !== undefined;
    const contentHash = needsRehash
      ? computeContentHash({
          name: input.name ?? submission.name,
          description: input.description ?? submission.description,
          repoUrl: input.repoUrl !== undefined ? input.repoUrl : submission.repoUrl,
        })
      : undefined;

    const [updated] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(submissions)
        .set({
          ...input,
          ...(contentHash ? { contentHash } : {}),
          ...(wasSubmitted ? { status: "draft" as const, submittedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(submissions.id, submissionId))
        .returning();

      await tx.insert(submissionRevisions).values({
        submissionId,
        snapshot: rows[0],
        editedByUserId: currentUser.id,
      });

      return rows;
    });

    return updated;
  }

  // FR-SUB-02 — locks the current draft in for judging.
  async submit(submissionId: string, currentUser: CurrentUser) {
    const { submission, event } = await this.assertCanEdit(submissionId, currentUser);

    if (submission.status === "submitted") {
      throw new ConflictException({
        error: { code: "CONFLICT", message: "Already submitted" },
      });
    }

    await this.assertSubmissionWindowOpen(event, currentUser.id, "submit", {
      resourceType: "submission",
      resourceId: submissionId,
    });

    const requiredQuestions = await this.db
      .select()
      .from(customQuestions)
      .where(
        and(
          eq(customQuestions.eventId, event.id),
          eq(customQuestions.required, true),
          or(isNull(customQuestions.trackId), eq(customQuestions.trackId, submission.trackId)),
        ),
      );
    if (requiredQuestions.length > 0) {
      const answers = await this.db
        .select()
        .from(customAnswers)
        .where(eq(customAnswers.submissionId, submissionId));
      const answered = new Set(
        answers.filter((a) => a.value !== null && a.value !== "").map((a) => a.customQuestionId),
      );
      const missing = requiredQuestions.filter((q) => !answered.has(q.id));
      if (missing.length > 0) {
        throw new BadRequestException({
          error: {
            code: "VALIDATION_ERROR",
            message: `Missing required answers: ${missing.map((q) => q.label).join(", ")}`,
          },
        });
      }
    }

    const [updated] = await this.db
      .update(submissions)
      .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(submissions.id, submissionId))
      .returning();

    await this.webhooks.trigger(event.id, "submission.received", {
      submissionId: updated.id,
      name: updated.name,
      trackId: updated.trackId,
      submittedAt: updated.submittedAt,
    });

    return updated;
  }

  // Backs the web UI's submission form — a team's existing submissions for
  // this event, so the form can offer "edit" instead of only "create."
  async findMineForEvent(eventId: string, userId: string) {
    const [teamRow] = await this.db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, userId)));

    if (!teamRow) {
      return [];
    }
    return this.db.select().from(submissions).where(eq(submissions.teamId, teamRow.team.id));
  }

  // FR-ABUSE-02/03 — flags likely resubmissions/scraped content for
  // organizer review; never auto-rejects anything (a coincidental match on
  // a common project idea is possible, and the call on whether it's
  // actually abuse belongs to a human, not this heuristic).
  // FR-ABUSE-02 — three independent signals, each flagging a different
  // kind of likely resubmission/scraped content, not a single check. A
  // submission can appear in more than one group (e.g. exact AND
  // thumbnail) — that's a stronger signal, not a bug, so groups aren't
  // deduplicated against each other.
  async findDuplicates(eventId: string): Promise<DuplicateGroup[]> {
    const rows = await this.db
      .select({ submission: submissions })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(eq(teams.eventId, eventId));
    const all = rows.map((r) => r.submission);

    const groups: DuplicateGroup[] = [];

    const byContentHash = new Map<string, typeof all>();
    for (const s of all) {
      if (!s.contentHash) {
        continue;
      }
      const group = byContentHash.get(s.contentHash) ?? [];
      group.push(s);
      byContentHash.set(s.contentHash, group);
    }
    for (const [hash, group] of byContentHash) {
      if (group.length > 1) {
        groups.push({
          kind: "exact",
          key: hash,
          submissions: group.map((s) => ({ id: s.id, name: s.name })),
        });
      }
    }

    const byThumbnailHash = new Map<string, typeof all>();
    for (const s of all) {
      const hash = computeThumbnailHash(s.thumbnailUrl);
      if (!hash) {
        continue;
      }
      const group = byThumbnailHash.get(hash) ?? [];
      group.push(s);
      byThumbnailHash.set(hash, group);
    }
    for (const [hash, group] of byThumbnailHash) {
      if (group.length > 1) {
        groups.push({
          kind: "thumbnail",
          key: hash,
          submissions: group.map((s) => ({ id: s.id, name: s.name })),
        });
      }
    }

    // O(n²) pairwise comparison — fine at hackathon scale (tens to low
    // hundreds of submissions per event, per JUDGING.md's own stated
    // scale for the algorithmic-assignment rotation).
    const wordSets = all.map((s) => wordSet(`${s.name} ${s.description}`));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        // already caught as exact
        if (all[i].contentHash && all[i].contentHash === all[j].contentHash) {
          continue;
        }
        const similarity = jaccardSimilarity(wordSets[i], wordSets[j]);
        if (similarity >= SIMILARITY_THRESHOLD) {
          groups.push({
            kind: "similar",
            key: `${all[i].id}|${all[j].id}`,
            similarity,
            submissions: [
              { id: all[i].id, name: all[i].name },
              { id: all[j].id, name: all[j].name },
            ],
          });
        }
      }
    }

    return groups;
  }

  // FR-SUB-04 — organizer/admin only; the audit trail of draft edits.
  async revisions(submissionId: string, currentUser: CurrentUser) {
    const { event } = await loadSubmissionWithEvent(this.db, submissionId);
    if (!isEventOrganizer(currentUser, event.id)) {
      throw new ForbiddenException();
    }

    return this.db
      .select()
      .from(submissionRevisions)
      .where(eq(submissionRevisions.submissionId, submissionId))
      .orderBy(desc(submissionRevisions.createdAt));
  }

  // FR-SUB-01 — same edit rules as the rest of the submission: any team
  // member, until locked.
  async setCustomAnswers(
    submissionId: string,
    input: SetCustomAnswersInput,
    currentUser: CurrentUser,
  ) {
    await this.assertCanEdit(submissionId, currentUser);

    return this.db.transaction(async (tx) => {
      const rows = [];
      for (const answer of input.answers) {
        const [row] = await tx
          .insert(customAnswers)
          .values({
            submissionId,
            customQuestionId: answer.customQuestionId,
            value: answer.value,
          })
          .onConflictDoUpdate({
            target: [customAnswers.submissionId, customAnswers.customQuestionId],
            set: { value: answer.value },
          })
          .returning();
        rows.push(row);
      }
      return rows;
    });
  }

  // Reuses findOne()'s draft/gallery-visibility gate rather than trusting
  // the route's @Public() decorator alone — an anonymous visitor should
  // see a submitted project's answers under the same rules as the
  // submission itself, never a draft's.
  async getCustomAnswers(submissionId: string, currentUser: CurrentUser | null) {
    await this.findOne(submissionId, currentUser);
    return this.db.select().from(customAnswers).where(eq(customAnswers.submissionId, submissionId));
  }
}
