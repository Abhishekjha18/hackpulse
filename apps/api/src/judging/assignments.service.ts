import { type CreateAssignmentsInput, ERROR_CODE } from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, eq, inArray } from "drizzle-orm";

import { JudgeTrackScopeService } from "../common/judge-track-scope.service";
import type { Database } from "../db/client";
import {
  eventRoles,
  events,
  judgeAssignments,
  judgeTrackScopes,
  profiles,
  submissions,
  teamMembers,
  tracks,
  user,
} from "../db/schema";
import { DB } from "../db/tokens";

@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly judgeTrackScope: JudgeTrackScopeService,
  ) {}

  // FR-JASSIGN-02: conflict-of-interest exclusion by declared affiliation.
  // A conflict is a case-insensitive workplace match between a candidate
  // judge and any team member; two blank workplaces never match each
  // other. A judge who's actually on the team can't happen at all, since
  // TeamsService and EventRoleInvitesService both block that combination.
  private async conflictedJudgeIds(
    teamId: string,
    candidateJudgeIds: string[],
  ): Promise<Set<string>> {
    if (candidateJudgeIds.length === 0) {
      return new Set();
    }

    const members = await this.db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, teamId));
    if (members.length === 0) {
      return new Set();
    }

    const memberProfiles = await this.db
      .select({ workplace: profiles.workplace })
      .from(profiles)
      .where(
        inArray(
          profiles.userId,
          members.map((m) => m.userId),
        ),
      );
    const memberWorkplaces = new Set(
      memberProfiles.map((p) => p.workplace.trim().toLowerCase()).filter((w) => w.length > 0),
    );
    if (memberWorkplaces.size === 0) {
      return new Set();
    }

    const judgeProfiles = await this.db
      .select({ userId: profiles.userId, workplace: profiles.workplace })
      .from(profiles)
      .where(inArray(profiles.userId, candidateJudgeIds));
    return new Set(
      judgeProfiles
        .filter((p) => memberWorkplaces.has(p.workplace.trim().toLowerCase()))
        .map((p) => p.userId),
    );
  }

  // FR-JASSIGN-02: a pair is only ever created if the judge is scoped to
  // the submission's track (ARCHITECTURE.md §6's structural half of track
  // isolation).
  // Requested explicitly: assignment should wait for the judging phase
  // itself, not just for submissions to have stopped — an organizer could
  // otherwise assign the moment submissions closed, even when judgingOpenAt
  // was deliberately later still. createAlgorithmic also doesn't "top up"
  // an existing assignment (it always adds minJudgesPerSubmission more), so
  // an early run followed by a second one after more submissions arrive
  // risks over-assigning the ones already covered — another reason to wait
  // for the real judging window, not just for submissions being done.
  // Automatic mode (judgingOpenAt set): the timestamp is the truth.
  // judgingOpenAt >= submissionCloseAt is already guaranteed at
  // create/update time, so this is never looser than gating on
  // submissionCloseAt would be, only ever equal or stricter.
  // Manual mode (null): there's no separate "assignment window" between
  // submissions closing and judging opening — assignment is allowed once
  // status has moved to "judging", same as scoring itself.
  private async assertJudgingPhaseStarted(eventId: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    if (event.judgingOpenAt === null) {
      if (event.status !== "judging") {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.JUDGING_NOT_STARTED,
            message: "Judges can't be assigned until the event moves to judging",
          },
        });
      }
      return;
    }
    if (new Date() < event.judgingOpenAt) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.JUDGING_NOT_STARTED,
          message: "Judges can't be assigned until the judging phase has started",
        },
      });
    }
  }

  async create(eventId: string, input: CreateAssignmentsInput, assignedByUserId: string) {
    await this.assertJudgingPhaseStarted(eventId);
    if (input.strategy === "manual") {
      return this.createManual(
        eventId,
        input.submissionIds,
        input.judgeUserIds,
        assignedByUserId,
        !!input.force,
      );
    }
    return this.createAlgorithmic(
      eventId,
      input.trackId,
      input.minJudgesPerSubmission,
      assignedByUserId,
    );
  }

  private async createManual(
    eventId: string,
    submissionIds: string[],
    judgeUserIds: string[],
    assignedByUserId: string,
    force: boolean,
  ) {
    const subs = await this.db
      .select()
      .from(submissions)
      .where(inArray(submissions.id, submissionIds));

    const created = [];
    const skipped: { submissionId: string; judgeUserId: string; reason: string }[] = [];

    for (const sub of subs) {
      const conflicted = force
        ? new Set<string>()
        : await this.conflictedJudgeIds(sub.teamId, judgeUserIds);
      for (const judgeUserId of judgeUserIds) {
        const scoped = await this.judgeTrackScope.isScoped(eventId, judgeUserId, sub.trackId);
        if (!scoped) {
          skipped.push({
            submissionId: sub.id,
            judgeUserId,
            reason: "judge is not scoped to this submission's track",
          });
          continue;
        }
        // Warn, don't block: organizer-overridable (force: true), since a
        // small event might have no unconflicted judge left for one
        // submission.
        if (conflicted.has(judgeUserId)) {
          skipped.push({
            submissionId: sub.id,
            judgeUserId,
            reason: "conflict of interest: judge shares a declared workplace with a team member",
          });
          continue;
        }

        const row = await this.insertAssignmentIfNew(
          eventId,
          judgeUserId,
          sub.id,
          assignedByUserId,
        );
        if (row) {
          created.push(row);
        }
      }
    }

    return { created, skipped };
  }

  // Shared by createManual and createAlgorithmic: both hit the same
  // unique(judge, submission) constraint, and an existing pair is a no-op,
  // not an error.
  private async insertAssignmentIfNew(
    eventId: string,
    judgeUserId: string,
    submissionId: string,
    assignedByUserId: string,
  ) {
    const [row] = await this.db
      .insert(judgeAssignments)
      .values({ eventId, judgeUserId, submissionId, assignedByUserId })
      .onConflictDoNothing()
      .returning();
    return row;
  }

  private async createAlgorithmic(
    eventId: string,
    trackId: string,
    minJudgesPerSubmission: number,
    assignedByUserId: string,
  ) {
    const subs = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.trackId, trackId), eq(submissions.status, "submitted")));

    const judges = await this.judgeTrackScope.scopedJudgesForTrack(eventId, trackId);
    if (judges.length === 0) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: "No judges are scoped to this track yet",
        },
      });
    }

    // FR-JASSIGN-02: load-balanced, not blind rotation. Found live: a
    // plain round-robin `offset` reset to 0 on every call, so a judge
    // scoped to multiple tracks (or just called a second time) could end
    // up with 3 assignments while an equally-eligible judge on the same
    // track got 0 — the rotation had no idea who already had load, from
    // this call *or* any earlier one. Loaded once per event (not per
    // track) up front, since a judge's real load spans every track
    // they're scoped to, then kept updated in-memory as this run assigns
    // more, so later submissions in the same call see the earlier ones'
    // effect too.
    const existingLoad = await this.db
      .select({ judgeUserId: judgeAssignments.judgeUserId, count: count() })
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, eventId))
      .groupBy(judgeAssignments.judgeUserId);
    const loadByJudge = new Map(existingLoad.map((r) => [r.judgeUserId, r.count]));

    // Tie-break for equally-loaded judges: fewer total track scopes on
    // this event first. Found live even after the load-balancing above —
    // a judge scoped to only one track and a judge scoped to all of them
    // both start this track's run at 0 load, so a tie-break that ignores
    // how many *other* chances each judge has left can still starve the
    // narrowly-scoped one: pick the two broadly-scoped judges for this
    // track (a coin-flip tie, but *a* tie), and by the time their other
    // tracks are processed, the single-track judge has already missed
    // their only opportunity and every later track's own tie is decided
    // among judges who still have other tracks to fall back on, while a
    // single-track judge does not. Scoped counts don't change across
    // this call's submissions, so queried once up front.
    const scopeCounts = await this.db
      .select({ judgeUserId: eventRoles.userId, count: count() })
      .from(judgeTrackScopes)
      .innerJoin(eventRoles, eq(eventRoles.id, judgeTrackScopes.eventRoleId))
      .where(and(eq(eventRoles.eventId, eventId), eq(eventRoles.role, "judge")))
      .groupBy(eventRoles.userId);
    const scopeCountByJudge = new Map(scopeCounts.map((r) => [r.judgeUserId, r.count]));

    const created = [];
    for (const sub of subs) {
      const conflicted = await this.conflictedJudgeIds(
        sub.teamId,
        judges.map((j) => j.judgeUserId),
      );
      const eligibleJudges =
        conflicted.size === 0 ? judges : judges.filter((j) => !conflicted.has(j.judgeUserId));

      // Least-loaded first; ties broken by fewest track scopes (the
      // judge with the fewest other chances goes first), then by the
      // query's own order as a last resort.
      const ranked = [...eligibleJudges].sort((a, b) => {
        const loadDiff =
          (loadByJudge.get(a.judgeUserId) ?? 0) - (loadByJudge.get(b.judgeUserId) ?? 0);
        if (loadDiff !== 0) {
          return loadDiff;
        }
        return (
          (scopeCountByJudge.get(a.judgeUserId) ?? 0) - (scopeCountByJudge.get(b.judgeUserId) ?? 0)
        );
      });
      const chosen = ranked.slice(0, minJudgesPerSubmission);

      for (const { judgeUserId } of chosen) {
        const row = await this.insertAssignmentIfNew(
          eventId,
          judgeUserId,
          sub.id,
          assignedByUserId,
        );
        if (row) {
          created.push(row);
          loadByJudge.set(judgeUserId, (loadByJudge.get(judgeUserId) ?? 0) + 1);
        }
      }
    }

    return { created, skipped: [] as unknown[] };
  }

  // FR-JASSIGN-03: only ever this judge's own assignments.
  async getQueue(eventId: string, judgeUserId: string) {
    return this.db
      .select({ assignment: judgeAssignments, submission: submissions })
      .from(judgeAssignments)
      .innerJoin(submissions, eq(submissions.id, judgeAssignments.submissionId))
      .where(
        and(eq(judgeAssignments.eventId, eventId), eq(judgeAssignments.judgeUserId, judgeUserId)),
      );
  }

  // FR-DASH-01: who hasn't started, aggregated in-process rather than a
  // SQL GROUP BY, since a single event's dataset is small enough for it.
  async getProgress(eventId: string) {
    const rows = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.eventId, eventId));

    // Judge name is included here for the organizer dashboard; safe since
    // organizers already have judge-management access to the event.
    const judgeIds = [...new Set(rows.map((a) => a.judgeUserId))];
    const judgeNames = judgeIds.length
      ? await this.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, judgeIds))
      : [];
    const nameById = new Map(judgeNames.map((j) => [j.id, j.name]));

    const byJudge = new Map<
      string,
      { judgeUserId: string; judgeName: string; total: number; completed: number }
    >();
    const bySubmission = new Map<
      string,
      { submissionId: string; assigned: number; completed: number }
    >();

    for (const a of rows) {
      const j = byJudge.get(a.judgeUserId) ?? {
        judgeUserId: a.judgeUserId,
        judgeName: nameById.get(a.judgeUserId) ?? a.judgeUserId,
        total: 0,
        completed: 0,
      };
      j.total += 1;
      if (a.status === "completed") {
        j.completed += 1;
      }
      byJudge.set(a.judgeUserId, j);

      const s = bySubmission.get(a.submissionId) ?? {
        submissionId: a.submissionId,
        assigned: 0,
        completed: 0,
      };
      s.assigned += 1;
      if (a.status === "completed") {
        s.completed += 1;
      }
      bySubmission.set(a.submissionId, s);
    }

    // Assignment doesn't re-run itself when a submission arrives after the
    // last run, so this count lets the dashboard nudge the organizer to
    // re-run it instead of the submission silently sitting unassigned.
    const assignedSubmissionIds = new Set(rows.map((a) => a.submissionId));
    const submittedRows = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .innerJoin(tracks, eq(tracks.id, submissions.trackId))
      .where(and(eq(tracks.eventId, eventId), eq(submissions.status, "submitted")));
    const unassignedCount = submittedRows.filter((s) => !assignedSubmissionIds.has(s.id)).length;

    return {
      byJudge: [...byJudge.values()],
      bySubmission: [...bySubmission.values()],
      unassignedCount,
    };
  }
}
