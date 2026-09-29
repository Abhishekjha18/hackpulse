import { type CurrentUser, ERROR_CODE, EVENT_ROLE } from "@hackpulse/shared";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq, ilike, inArray } from "drizzle-orm";

import type { Database } from "../db/client";
import {
  comments,
  criterionScores,
  customAnswers,
  customQuestions,
  eventRoles,
  events,
  judgeAssignments,
  judgeTrackScopes,
  prizes,
  rubricCriteria,
  rubrics,
  scores,
  submissions,
  teamMembers,
  teams,
  tracks,
  user,
  votes,
} from "../db/schema";
import { DB } from "../db/tokens";
import { generateInviteCode } from "../teams/invite-code";

const ARCHIVE_VERSION = 1;

/**
 * FR-BULK-02 — the migration path out (and back in). Scope: the event's
 * structure and product data (tracks, rubrics, teams, submissions,
 * judging, votes, comments), not derived computation (normalized_results,
 * pairwise_rankings: regenerable from the raw scores/comparisons this
 * does carry), not the audit log (append-only and instance-specific,
 * ADR-009), and not account credentials (Better Auth's concern).
 *
 * User references travel as email addresses, resolved against accounts
 * already on the importing instance; unmatched references fall back to
 * the importer and are reported as warnings rather than dropped or
 * failing the whole import.
 */
@Injectable()
export class ArchiveService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async exportArchive(eventId: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const eventTracks = await this.db.select().from(tracks).where(eq(tracks.eventId, eventId));
    const eventPrizes = await this.db.select().from(prizes).where(eq(prizes.eventId, eventId));
    const eventCustomQuestions = await this.db
      .select()
      .from(customQuestions)
      .where(eq(customQuestions.eventId, eventId));

    const eventRubrics = await this.db.select().from(rubrics).where(eq(rubrics.eventId, eventId));
    const rubricIds = eventRubrics.map((r) => r.id);
    const eventRubricCriteria = rubricIds.length
      ? await this.db
          .select()
          .from(rubricCriteria)
          .where(inArray(rubricCriteria.rubricId, rubricIds))
      : [];

    const eventTeams = await this.db.select().from(teams).where(eq(teams.eventId, eventId));
    const teamIds = eventTeams.map((t) => t.id);
    const members = teamIds.length
      ? await this.db.select().from(teamMembers).where(inArray(teamMembers.teamId, teamIds))
      : [];
    const subs = teamIds.length
      ? await this.db.select().from(submissions).where(inArray(submissions.teamId, teamIds))
      : [];
    const subIds = subs.map((s) => s.id);
    const answers = subIds.length
      ? await this.db
          .select()
          .from(customAnswers)
          .where(inArray(customAnswers.submissionId, subIds))
      : [];

    const eventRolesRows = await this.db
      .select()
      .from(eventRoles)
      .where(eq(eventRoles.eventId, eventId));
    const eventRoleIds = eventRolesRows.map((r) => r.id);
    const judgeScopes = eventRoleIds.length
      ? await this.db
          .select()
          .from(judgeTrackScopes)
          .where(inArray(judgeTrackScopes.eventRoleId, eventRoleIds))
      : [];

    const assignments = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, eventId));
    const assignmentIds = assignments.map((a) => a.id);
    const scoreRows = assignmentIds.length
      ? await this.db.select().from(scores).where(inArray(scores.judgeAssignmentId, assignmentIds))
      : [];
    const scoreIds = scoreRows.map((s) => s.id);
    const critScores = scoreIds.length
      ? await this.db
          .select()
          .from(criterionScores)
          .where(inArray(criterionScores.scoreId, scoreIds))
      : [];

    const voteRows = await this.db.select().from(votes).where(eq(votes.eventId, eventId));
    const commentRows = subIds.length
      ? await this.db.select().from(comments).where(inArray(comments.submissionId, subIds))
      : [];

    const referencedUserIds = new Set<string>([event.ownerUserId]);
    for (const r of eventRolesRows) {
      referencedUserIds.add(r.userId);
    }
    for (const t of eventTeams) {
      referencedUserIds.add(t.ownerUserId);
    }
    for (const m of members) {
      referencedUserIds.add(m.userId);
    }
    for (const a of assignments) {
      referencedUserIds.add(a.judgeUserId);
      referencedUserIds.add(a.assignedByUserId);
    }
    for (const c of commentRows) {
      if (c.authorUserId) {
        referencedUserIds.add(c.authorUserId);
      }
    }

    const userRows = referencedUserIds.size
      ? await this.db
          .select({ id: user.id, email: user.email, name: user.name })
          .from(user)
          .where(inArray(user.id, [...referencedUserIds]))
      : [];

    return {
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      users: userRows,
      event,
      tracks: eventTracks,
      prizes: eventPrizes,
      customQuestions: eventCustomQuestions,
      rubrics: eventRubrics,
      rubricCriteria: eventRubricCriteria,
      eventRoles: eventRolesRows,
      judgeTrackScopes: judgeScopes,
      teams: eventTeams,
      teamMembers: members,
      submissions: subs,
      customAnswers: answers,
      judgeAssignments: assignments,
      scores: scoreRows,
      criterionScores: critScores,
      votes: voteRows,
      comments: commentRows,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async importArchive(archive: any, importingUser: CurrentUser) {
    // Same gate as EventsService.create(): this also mints a new event
    // with the importer as its organizer.
    if (!importingUser.isAdmin && !importingUser.canOrganizeEvents) {
      throw new ForbiddenException({
        error: {
          code: ERROR_CODE.NOT_AUTHORIZED_TO_ORGANIZE,
          message:
            "You don't have permission to create events. Ask an admin to grant you organizer access.",
        },
      });
    }
    if (!archive || archive.version !== ARCHIVE_VERSION || !archive.event) {
      throw new NotFoundException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: "Not a recognizable HackPulse event archive",
        },
      });
    }

    const warnings: string[] = [];
    const emailToId = new Map<string, string>();
    for (const u of archive.users ?? []) {
      const [existing] = await this.db
        .select({ id: user.id })
        .from(user)
        .where(ilike(user.email, u.email));
      if (existing) {
        emailToId.set(u.id, existing.id);
      }
    }
    const resolveUser = (oldId: string): string | null => {
      const resolved = emailToId.get(oldId);
      if (!resolved) {
        warnings.push(
          `No account on this instance matches the imported user ${oldId}. Substituted the importer`,
        );
        return null;
      }
      return resolved;
    };

    return this.db.transaction(async (tx) => {
      let slug = archive.event.slug as string;
      const [slugTaken] = await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, slug));
      if (slugTaken) {
        slug = `${slug}-import-${Date.now()}`;
      }

      const [newEvent] = await tx
        .insert(events)
        .values({
          slug,
          name: archive.event.name,
          description: archive.event.description ?? "",
          ownerUserId: importingUser.id,
          timezone: archive.event.timezone,
          registrationOpenAt: new Date(archive.event.registrationOpenAt),
          registrationCloseAt: new Date(archive.event.registrationCloseAt),
          submissionOpenAt: new Date(archive.event.submissionOpenAt),
          submissionCloseAt: new Date(archive.event.submissionCloseAt),
          judgingOpenAt: new Date(archive.event.judgingOpenAt),
          judgingCloseAt: new Date(archive.event.judgingCloseAt),
          galleryVisibility: archive.event.galleryVisibility,
          votingMode: archive.event.votingMode,
          votingAccess: archive.event.votingAccess,
          scoringMode: archive.event.scoringMode,
          maxTeamSize: archive.event.maxTeamSize,
        })
        .returning();

      await tx
        .insert(eventRoles)
        .values({ eventId: newEvent.id, userId: importingUser.id, role: EVENT_ROLE.ORGANIZER });

      const trackIdMap = new Map<string, string>();
      for (const t of archive.tracks ?? []) {
        const [nt] = await tx
          .insert(tracks)
          .values({
            eventId: newEvent.id,
            name: t.name,
            description: t.description,
            sortOrder: t.sortOrder,
          })
          .returning();
        trackIdMap.set(t.id, nt.id);
      }

      for (const p of archive.prizes ?? []) {
        await tx.insert(prizes).values({
          eventId: newEvent.id,
          trackId: p.trackId ? (trackIdMap.get(p.trackId) ?? null) : null,
          name: p.name,
          description: p.description,
        });
      }

      const cqIdMap = new Map<string, string>();
      for (const cq of archive.customQuestions ?? []) {
        const [ncq] = await tx
          .insert(customQuestions)
          .values({
            eventId: newEvent.id,
            trackId: cq.trackId ? (trackIdMap.get(cq.trackId) ?? null) : null,
            label: cq.label,
            type: cq.type,
            options: cq.options,
            required: cq.required,
            sortOrder: cq.sortOrder,
          })
          .returning();
        cqIdMap.set(cq.id, ncq.id);
      }

      const rubricIdMap = new Map<string, string>();
      for (const r of archive.rubrics ?? []) {
        const [nr] = await tx
          .insert(rubrics)
          .values({
            eventId: newEvent.id,
            trackId: r.trackId ? (trackIdMap.get(r.trackId) ?? null) : null,
            name: r.name,
            scaleMin: r.scaleMin,
            scaleMax: r.scaleMax,
          })
          .returning();
        rubricIdMap.set(r.id, nr.id);
      }

      const criterionIdMap = new Map<string, string>();
      for (const c of archive.rubricCriteria ?? []) {
        const newRubricId = rubricIdMap.get(c.rubricId);
        if (!newRubricId) {
          continue;
        }
        const [nc] = await tx
          .insert(rubricCriteria)
          .values({
            rubricId: newRubricId,
            name: c.name,
            description: c.description,
            weight: c.weight,
            sortOrder: c.sortOrder,
          })
          .returning();
        criterionIdMap.set(c.id, nc.id);
      }

      const eventRoleIdMap = new Map<string, string>();
      for (const er of archive.eventRoles ?? []) {
        if (er.role !== EVENT_ROLE.JUDGE && er.role !== EVENT_ROLE.ORGANIZER) {
          continue;
        }
        const newUserId = resolveUser(er.userId);
        if (!newUserId) {
          continue;
        }
        // The importer was already granted organizer above; skip re-inserting
        // their own original row so co-organizers (everyone else) are what's
        // actually new here.
        if (er.role === EVENT_ROLE.ORGANIZER && newUserId === importingUser.id) {
          continue;
        }
        const [ner] = await tx
          .insert(eventRoles)
          .values({ eventId: newEvent.id, userId: newUserId, role: er.role })
          .onConflictDoNothing()
          .returning();
        if (ner) {
          eventRoleIdMap.set(er.id, ner.id);
        }
      }
      for (const scope of archive.judgeTrackScopes ?? []) {
        const newErId = eventRoleIdMap.get(scope.eventRoleId);
        const newTrackId = trackIdMap.get(scope.trackId);
        if (!newErId || !newTrackId) {
          continue;
        }
        await tx.insert(judgeTrackScopes).values({ eventRoleId: newErId, trackId: newTrackId });
      }

      const teamIdMap = new Map<string, string>();
      for (const t of archive.teams ?? []) {
        const ownerNewId = resolveUser(t.ownerUserId) ?? importingUser.id;
        const [nt] = await tx
          .insert(teams)
          .values({
            eventId: newEvent.id,
            name: t.name,
            ownerUserId: ownerNewId,
            inviteCode: generateInviteCode(),
          })
          .returning();
        teamIdMap.set(t.id, nt.id);
      }
      for (const m of archive.teamMembers ?? []) {
        const newTeamId = teamIdMap.get(m.teamId);
        const newUserId = resolveUser(m.userId) ?? importingUser.id;
        if (!newTeamId) {
          continue;
        }
        await tx
          .insert(teamMembers)
          .values({ teamId: newTeamId, userId: newUserId })
          .onConflictDoNothing();
      }

      const subIdMap = new Map<string, string>();
      for (const s of archive.submissions ?? []) {
        const newTeamId = teamIdMap.get(s.teamId);
        const newTrackId = trackIdMap.get(s.trackId);
        if (!newTeamId || !newTrackId) {
          warnings.push(`Skipped submission "${s.name}": its team or track wasn't imported`);
          continue;
        }
        const [ns] = await tx
          .insert(submissions)
          .values({
            teamId: newTeamId,
            trackId: newTrackId,
            name: s.name,
            tagline: s.tagline,
            description: s.description,
            thumbnailUrl: s.thumbnailUrl,
            galleryImageUrls: s.galleryImageUrls ?? [],
            demoVideoUrl: s.demoVideoUrl,
            repoUrl: s.repoUrl,
            liveUrl: s.liveUrl,
            techTags: s.techTags ?? [],
            status: s.status,
            submittedAt: s.submittedAt ? new Date(s.submittedAt) : null,
          })
          .returning();
        subIdMap.set(s.id, ns.id);
      }
      for (const a of archive.customAnswers ?? []) {
        const newSubId = subIdMap.get(a.submissionId);
        const newCqId = cqIdMap.get(a.customQuestionId);
        if (!newSubId || !newCqId) {
          continue;
        }
        await tx
          .insert(customAnswers)
          .values({ submissionId: newSubId, customQuestionId: newCqId, value: a.value });
      }

      const assignmentIdMap = new Map<string, string>();
      for (const a of archive.judgeAssignments ?? []) {
        const newSubId = subIdMap.get(a.submissionId);
        const newJudgeId = resolveUser(a.judgeUserId);
        if (!newSubId || !newJudgeId) {
          continue;
        }
        const [na] = await tx
          .insert(judgeAssignments)
          .values({
            eventId: newEvent.id,
            judgeUserId: newJudgeId,
            submissionId: newSubId,
            status: a.status,
            assignedByUserId: importingUser.id,
          })
          .onConflictDoNothing()
          .returning();
        if (na) {
          assignmentIdMap.set(a.id, na.id);
        }
      }

      const scoreIdMap = new Map<string, string>();
      for (const s of archive.scores ?? []) {
        const newAssignmentId = assignmentIdMap.get(s.judgeAssignmentId);
        const newRubricId = rubricIdMap.get(s.rubricId);
        if (!newAssignmentId || !newRubricId) {
          continue;
        }
        const [ns] = await tx
          .insert(scores)
          .values({
            judgeAssignmentId: newAssignmentId,
            rubricId: newRubricId,
            status: s.status,
            rawWeightedScore: s.rawWeightedScore,
            overallFeedback: s.overallFeedback,
            submittedAt: s.submittedAt ? new Date(s.submittedAt) : null,
          })
          .returning();
        scoreIdMap.set(s.id, ns.id);
      }
      for (const cs of archive.criterionScores ?? []) {
        const newScoreId = scoreIdMap.get(cs.scoreId);
        const newCriterionId = criterionIdMap.get(cs.rubricCriterionId);
        if (!newScoreId || !newCriterionId) {
          continue;
        }
        await tx.insert(criterionScores).values({
          scoreId: newScoreId,
          rubricCriterionId: newCriterionId,
          value: cs.value,
          feedback: cs.feedback,
        });
      }

      for (const v of archive.votes ?? []) {
        const newSubId = subIdMap.get(v.submissionId);
        if (!newSubId) {
          continue;
        }
        await tx
          .insert(votes)
          .values({
            eventId: newEvent.id,
            submissionId: newSubId,
            voterId: v.voterId,
            votesCast: v.votesCast,
            costPaid: v.costPaid,
            ipHash: v.ipHash,
          })
          .onConflictDoNothing();
      }
      for (const c of archive.comments ?? []) {
        const newSubId = subIdMap.get(c.submissionId);
        if (!newSubId) {
          continue;
        }
        await tx.insert(comments).values({
          submissionId: newSubId,
          authorLabel: c.authorLabel,
          authorUserId: c.authorUserId ? resolveUser(c.authorUserId) : null,
          body: c.body,
        });
      }

      return { event: newEvent, warnings };
    });
  }
}
