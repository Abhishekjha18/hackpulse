import type { CurrentUser } from "@hackpulse/shared";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import type { Database } from "../db/client";
import {
  events,
  judgeAssignments,
  pairwiseComparisons,
  rubrics,
  submissions,
  teams,
  tracks,
} from "../db/schema";
import { DB } from "../db/tokens";
import { NormalizationService } from "../judging/normalization.service";
import { VotingService } from "../voting/voting.service";
import { WebhooksService } from "../webhooks/webhooks.service";

@Injectable()
export class ResultsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly normalization: NormalizationService,
    private readonly voting: VotingService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  // Requested explicitly: a rubric's own rankings are always event-wide
  // (one z-score scale, ranked together, regardless of which track a
  // submission entered) — genuinely correct as an "overall" ranking, but
  // there was no per-track breakdown of that same data anywhere. Derived
  // here from the already-computed normalizedMean, not stored separately:
  // re-grouping and re-ranking (1..N within each track, using the exact
  // same score that produced the overall rank) needs no schema change and
  // stays consistent with the overall ranking by construction, since
  // they're the same underlying numbers.
  // Generic over T (not just the four bare fields) so extra fields a
  // caller's rows already carry -- submissionName/teamName, added by
  // withNames in assemble() below -- are reflected in this method's own
  // return type too, not just present at runtime via the {...row} spread
  // further down.
  private async computeTrackRankings<
    T extends { submissionId: string; rawMean: string; normalizedMean: string; rank: number },
  >(eventId: string, rankings: T[]) {
    if (rankings.length === 0) {
      return [];
    }
    const submissionTracks = await this.db
      .select({ id: submissions.id, trackId: submissions.trackId })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(eq(teams.eventId, eventId));
    const trackIdBySubmission = new Map(submissionTracks.map((s) => [s.id, s.trackId]));

    const eventTracks = await this.db.select().from(tracks).where(eq(tracks.eventId, eventId));
    const trackNameById = new Map(eventTracks.map((t) => [t.id, t.name]));

    const byTrack = new Map<string, typeof rankings>();
    for (const row of rankings) {
      const trackId = trackIdBySubmission.get(row.submissionId);
      if (!trackId) {
        continue;
      }
      const group = byTrack.get(trackId) ?? [];
      group.push(row);
      byTrack.set(trackId, group);
    }

    return (
      [...byTrack.entries()]
        .map(([trackId, group]) => ({
          trackId,
          trackName: trackNameById.get(trackId) ?? "Unknown track",
          rankings: [...group]
            .sort((a, b) => Number(b.normalizedMean) - Number(a.normalizedMean))
            .map((row, i) => ({ ...row, rank: i + 1 })),
        }))
        // Stable, readable ordering — alphabetical by track name, not
        // insertion order (which would otherwise be arbitrary here).
        .sort((a, b) => a.trackName.localeCompare(b.trackName))
    );
  }

  // Found live ("only the submission id is showing up... no one will be
  // able to make out what this even means"): every ranking/tally row
  // this service assembles only ever carried submissionId -- none of
  // normalization.getResults/pairwise.getRankings/voting.getTally join
  // out to a readable name, since each is also used elsewhere for raw
  // computation where an id is all that's needed. One join here, in the
  // single place that actually builds the results *page's* payload,
  // rather than widening those three services' own return shapes (other
  // callers of theirs don't need this and shouldn't have to carry it).
  private async submissionInfoMap(
    eventId: string,
  ): Promise<Map<string, { submissionName: string; teamName: string }>> {
    const rows = await this.db
      .select({ id: submissions.id, name: submissions.name, teamName: teams.name })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(eq(teams.eventId, eventId));
    return new Map(rows.map((r) => [r.id, { submissionName: r.name, teamName: r.teamName }]));
  }

  private async assemble(eventId: string) {
    const info = await this.submissionInfoMap(eventId);
    const withNames = <T extends { submissionId: string }>(rows: T[]) =>
      rows.map((r) => ({
        ...r,
        submissionName: info.get(r.submissionId)?.submissionName ?? "Unknown submission",
        teamName: info.get(r.submissionId)?.teamName ?? "Unknown team",
      }));

    const eventRubrics = await this.db.select().from(rubrics).where(eq(rubrics.eventId, eventId));
    const rubricResults = await Promise.all(
      eventRubrics.map(async (r) => {
        // withNames before computeTrackRankings, not after: its own row
        // spread ({...row, rank: i + 1}) then carries submissionName/
        // teamName through into trackRankings for free, so both the
        // overall and per-track tables share one enrichment pass.
        const rankings = withNames(await this.normalization.getResults(r.id));
        return {
          rubricId: r.id,
          rubricName: r.name,
          trackId: r.trackId,
          rankings,
          trackRankings: await this.computeTrackRankings(eventId, rankings),
        };
      }),
    );

    const voteTally = withNames(await this.voting.getTally(eventId, true));
    return { rubricResults, voteTally };
  }

  // FR-RESULT-01/02: hidden from everyone but organizers until published.
  // FR-RESULT-01 says "organizers/admins" specifically, so admin gets a
  // read-only exception here too, additive to (not a replacement for)
  // isEventOrganizer, same oversight posture as the audit log's FR-ABUSE-05.
  async getResults(eventId: string, currentUser: CurrentUser | null) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    if (
      event.status !== "results_published" &&
      !isEventOrganizer(currentUser, eventId) &&
      !currentUser?.isAdmin
    ) {
      throw new ForbiddenException();
    }
    return this.assemble(eventId);
  }

  async getPreview(eventId: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    return this.assemble(eventId);
  }

  // Scoring-mode aware, not a single query: a pairwise event never creates
  // judgeAssignments rows at all, so "judged" means different things per
  // mode. Here it means at least one completed score or comparison, not
  // that every assigned judge finished, which could block a publish
  // indefinitely on one unresponsive judge.
  async findUnjudgedSubmissions(eventId: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const submitted = await this.db
      .select({ id: submissions.id, name: submissions.name })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(and(eq(teams.eventId, eventId), eq(submissions.status, "submitted")));
    if (submitted.length === 0) {
      return [];
    }

    const judgedIds = new Set<string>();
    if (event.scoringMode === "pairwise") {
      const rows = await this.db
        .select({ a: pairwiseComparisons.submissionAId, b: pairwiseComparisons.submissionBId })
        .from(pairwiseComparisons)
        .where(eq(pairwiseComparisons.eventId, eventId));
      for (const r of rows) {
        judgedIds.add(r.a);
        judgedIds.add(r.b);
      }
    } else {
      const rows = await this.db
        .select({ submissionId: judgeAssignments.submissionId })
        .from(judgeAssignments)
        .where(
          and(eq(judgeAssignments.eventId, eventId), eq(judgeAssignments.status, "completed")),
        );
      for (const r of rows) {
        judgedIds.add(r.submissionId);
      }
    }

    return submitted.filter((s) => !judgedIds.has(s.id));
  }

  // FR-RESULT: publishing with an unjudged submission would silently show
  // a blank ranking for it, the exact "looks done but isn't" failure this
  // project's honesty-first posture exists to avoid. Checked here, not
  // just the UI, since FR-API-01 means it has to hold for a direct API
  // call too.
  async publish(eventId: string, currentUser: CurrentUser) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const unjudged = await this.findUnjudgedSubmissions(eventId);
    if (unjudged.length > 0) {
      throw new ConflictException({
        error: {
          code: "UNJUDGED_SUBMISSIONS",
          message:
            unjudged.length === 1
              ? `"${unjudged[0].name}" hasn't been judged yet. Results can't publish until every submitted project has at least one completed score or comparison.`
              : `${unjudged.length} submitted projects haven't been judged yet. Results can't publish until every submitted project has at least one completed score or comparison.`,
          submissionIds: unjudged.map((s) => s.id),
        },
      });
    }

    // Requested explicitly, on top of the "everyone judged" check above:
    // every submission having a score isn't the same as the judging window
    // actually being over, and publishing early would cut off a submission
    // that could still legitimately pick up a second opinion before the
    // declared deadline. Automatic mode checks the timestamp; manual mode
    // has no judgingCloseAt to check, so it requires status to actually be
    // "judging" instead — the organizer-driven equivalent.
    if (event.judgingCloseAt === null) {
      if (event.status !== "judging") {
        throw new ConflictException({
          error: {
            code: "JUDGING_STILL_OPEN",
            message: "Results can't publish until the event is in judging",
          },
        });
      }
    } else if (new Date() < event.judgingCloseAt) {
      throw new ConflictException({
        error: {
          code: "JUDGING_STILL_OPEN",
          message: "Results can't publish until the judging deadline has passed",
        },
      });
    }

    const [updated] = await this.db
      .update(events)
      .set({
        status: "results_published",
        resultsPublishAt: event.resultsPublishAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(events.id, eventId))
      .returning();

    await this.audit.log({
      eventId,
      actorUserId: currentUser.id,
      action: "results.publish",
      resourceType: "event",
      resourceId: eventId,
      metadata: {},
    });

    await this.webhooks.trigger(eventId, "results.published", {
      eventId,
      resultsPublishAt: updated.resultsPublishAt,
    });

    return updated;
  }
}
