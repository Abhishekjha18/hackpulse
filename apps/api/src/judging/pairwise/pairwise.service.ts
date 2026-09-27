import type { PairwiseCompareInput } from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, or } from "drizzle-orm";

import { AuditService } from "../../audit/audit.service";
import { JudgeTrackScopeService } from "../../common/judge-track-scope.service";
import type { Database } from "../../db/client";
import { pairwiseComparisons, pairwiseRankings, submissions, tracks, user } from "../../db/schema";
import { DB } from "../../db/tokens";
import { assertJudgingWindowOpen } from "../judging-window.util";
import { latestByKey } from "../latest-by-key.util";
import { bootstrapConfidenceIntervals, type Comparison, rank } from "./bradley-terry";

@Injectable()
export class PairwiseService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly judgeTrackScope: JudgeTrackScopeService,
  ) {}

  // FR-PAIR-03: prefers unseen pairs weighted toward least-compared submissions.
  // Track scope is enforced upstream by TrackScopeGuard.
  async getNextPair(eventId: string, trackId: string, judgeUserId: string) {
    const subs = await this.db
      .select()
      .from(submissions)
      .where(and(eq(submissions.trackId, trackId), eq(submissions.status, "submitted")));
    if (subs.length < 2) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "Need at least two submitted projects in this track",
        },
      });
    }

    const prior = await this.db
      .select()
      .from(pairwiseComparisons)
      .where(
        and(
          eq(pairwiseComparisons.trackId, trackId),
          eq(pairwiseComparisons.judgeUserId, judgeUserId),
        ),
      );

    const countBySubmission = new Map(subs.map((s) => [s.id, 0]));
    const comparedPairs = new Set<string>();
    for (const c of prior) {
      countBySubmission.set(c.submissionAId, (countBySubmission.get(c.submissionAId) ?? 0) + 1);
      countBySubmission.set(c.submissionBId, (countBySubmission.get(c.submissionBId) ?? 0) + 1);
      comparedPairs.add([c.submissionAId, c.submissionBId].sort().join("|"));
    }

    const sorted = [...subs].sort(
      (x, y) => (countBySubmission.get(x.id) ?? 0) - (countBySubmission.get(y.id) ?? 0),
    );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = [sorted[i].id, sorted[j].id].sort().join("|");
        if (!comparedPairs.has(key)) {
          return { submissionA: sorted[i], submissionB: sorted[j] };
        }
      }
    }

    // Found live ("the judge is stuck in a loop... these comparisons keep
    // repeating"): this used to fall back to re-serving a pair once every
    // pair had been seen once. Since the "least-compared" tiebreak above
    // recomputes fresh counts on every call, voting on an already-compared
    // pair again shifts which pair now looks "least compared" -- so
    // instead of settling on one static repeat, it quietly rotated
    // through every pair in the track forever, indistinguishable from a
    // genuine infinite loop to a judge who'd actually finished. Requested
    // explicitly ("once a judge has picked, it should get recorded and
    // not appear again"): once every pair has been compared exactly once,
    // there is nothing left to serve -- say so plainly instead of faking
    // a next pair.
    throw new ConflictException({
      error: {
        code: "ALL_PAIRS_COMPARED",
        message: "You've compared every pair in this track. Nothing left to judge here.",
      },
    });
  }

  // Found live: the notifications bell's "you have pending judging work"
  // reminder only ever checked the rubric-mode assignment queue
  // (judgeAssignments), which pairwise mode never populates at all --
  // no assignment concept exists there, only track scope. A pairwise
  // judge got no reminder, ever, ended session or not, since queue always
  // came back empty for them. "remaining" here means the count of pairs
  // this judge hasn't compared yet, per scoped track -- once getNextPair
  // (above) stops handing out a pair for this track at all, remaining is
  // exactly 0, matching getNextPair's own ALL_PAIRS_COMPARED cutoff.
  // Shared by getProgressForJudge and getProgressForOrganizer: how many
  // distinct pairs (regardless of submission order) a given judge has
  // recorded a comparison for, in one track. One place computing this so
  // the judge-facing and organizer-facing views can never quietly drift
  // apart on what "compared" means.
  private async comparedPairCount(trackId: string, judgeUserId: string): Promise<number> {
    const prior = await this.db
      .select()
      .from(pairwiseComparisons)
      .where(
        and(
          eq(pairwiseComparisons.trackId, trackId),
          eq(pairwiseComparisons.judgeUserId, judgeUserId),
        ),
      );
    return new Set(prior.map((c) => [c.submissionAId, c.submissionBId].sort().join("|"))).size;
  }

  private async totalPairsInTrack(trackId: string): Promise<number> {
    const subs = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.trackId, trackId), eq(submissions.status, "submitted")));
    const n = subs.length;
    return n >= 2 ? (n * (n - 1)) / 2 : 0;
  }

  async getProgressForJudge(eventId: string, judgeUserId: string) {
    const scopedTrackIds = await this.judgeTrackScope.scopedTracksForJudge(eventId, judgeUserId);
    if (scopedTrackIds.length === 0) {
      return [];
    }

    const scopedTracks = await this.db
      .select({ id: tracks.id, name: tracks.name })
      .from(tracks)
      .where(inArray(tracks.id, scopedTrackIds));

    return Promise.all(
      scopedTracks.map(async (track) => {
        const totalPairs = await this.totalPairsInTrack(track.id);
        const compared = await this.comparedPairCount(track.id, judgeUserId);
        const remaining = Math.max(0, totalPairs - compared);
        return { trackId: track.id, trackName: track.name, remaining, totalPairs };
      }),
    );
  }

  // Organizer-facing analog of AssignmentsService.getProgress (rubric
  // mode's "Judging progress" table) -- reported live ("nothing is shown
  // on judging progress and per-submission coverage either"): that
  // section reads judgeAssignments, which pairwise mode never populates,
  // so it silently showed "No assignments yet" for a pairwise event
  // regardless of how much real comparing had happened. One row per
  // (judge, track) rather than rubric mode's one row per judge overall --
  // a judge's coverage is inherently track-scoped here (a track's pair
  // count depends only on that track's own submissions), so collapsing
  // two tracks into one judge-wide total the way rubric mode does would
  // hide which specific track still needs attention. There's no
  // per-submission analog to add alongside this the way rubric mode has
  // one -- a submission's pairwise "coverage" isn't a single number, it's
  // how many of its pairs each individual judge has compared, which this
  // table already shows from the judge's side; the organizer dashboard
  // says so explicitly instead of showing an empty table.
  async getProgressForOrganizer(eventId: string) {
    const eventTracks = await this.db
      .select({ id: tracks.id, name: tracks.name })
      .from(tracks)
      .where(eq(tracks.eventId, eventId));

    const rows: {
      judgeUserId: string;
      judgeName: string;
      trackId: string;
      trackName: string;
      completed: number;
      total: number;
    }[] = [];

    for (const track of eventTracks) {
      const totalPairs = await this.totalPairsInTrack(track.id);
      const scopedJudges = await this.judgeTrackScope.scopedJudgesForTrack(eventId, track.id);
      if (scopedJudges.length === 0) {
        continue;
      }
      const judgeIds = [...new Set(scopedJudges.map((j) => j.judgeUserId))];
      const names = await this.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, judgeIds));
      const nameById = new Map(names.map((n) => [n.id, n.name]));

      for (const judgeUserId of judgeIds) {
        const completed = await this.comparedPairCount(track.id, judgeUserId);
        rows.push({
          judgeUserId,
          judgeName: nameById.get(judgeUserId) ?? judgeUserId,
          trackId: track.id,
          trackName: track.name,
          completed,
          total: totalPairs,
        });
      }
    }

    return rows;
  }

  async compare(eventId: string, input: PairwiseCompareInput, judgeUserId: string) {
    await assertJudgingWindowOpen(this.db, this.audit, eventId, judgeUserId, "pairwise_compare");

    const subs = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.trackId, input.trackId));
    const validIds = new Set(subs.map((s) => s.id));
    if (!validIds.has(input.submissionA) || !validIds.has(input.submissionB)) {
      throw new NotFoundException();
    }

    // Requested explicitly ("once a judge has picked, it should get
    // recorded and not appear again"): reject a repeat compare() for a
    // pair this judge already voted on, in either submission order --
    // not just relying on getNextPair never offering it again. Defense
    // in depth against a stale frontend, a resubmitted request, or a
    // direct API call; getNextPair's own ALL_PAIRS_COMPARED is what a
    // judge normally hits first.
    const [alreadyCompared] = await this.db
      .select({ id: pairwiseComparisons.id })
      .from(pairwiseComparisons)
      .where(
        and(
          eq(pairwiseComparisons.trackId, input.trackId),
          eq(pairwiseComparisons.judgeUserId, judgeUserId),
          or(
            and(
              eq(pairwiseComparisons.submissionAId, input.submissionA),
              eq(pairwiseComparisons.submissionBId, input.submissionB),
            ),
            and(
              eq(pairwiseComparisons.submissionAId, input.submissionB),
              eq(pairwiseComparisons.submissionBId, input.submissionA),
            ),
          )!,
        ),
      );
    if (alreadyCompared) {
      throw new ConflictException({
        error: { code: "ALREADY_COMPARED", message: "You've already compared this pair." },
      });
    }

    const [row] = await this.db
      .insert(pairwiseComparisons)
      .values({
        eventId,
        trackId: input.trackId,
        judgeUserId,
        submissionAId: input.submissionA,
        submissionBId: input.submissionB,
        winner: input.winner,
      })
      .returning();

    await this.recompute(eventId, input.trackId);
    return row;
  }

  async recompute(eventId: string, trackId: string) {
    const subs = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.trackId, trackId), eq(submissions.status, "submitted")));
    const items = subs.map((s) => s.id);
    if (items.length === 0) {
      return;
    }

    const rows = await this.db
      .select()
      .from(pairwiseComparisons)
      .where(
        and(eq(pairwiseComparisons.eventId, eventId), eq(pairwiseComparisons.trackId, trackId)),
      );
    const comparisons: Comparison[] = rows.map((r) => ({
      a: r.submissionAId,
      b: r.submissionBId,
      winner: r.winner,
    }));

    const ranked = rank(items, comparisons, 150);
    const ci = bootstrapConfidenceIntervals(items, comparisons, { iterations: 80, samples: 80 });

    await this.db.transaction(async (tx) => {
      for (const r of ranked) {
        const bounds = ci.get(r.item) ?? { low: r.strength, high: r.strength };
        await tx.insert(pairwiseRankings).values({
          eventId,
          trackId,
          submissionId: r.item,
          btStrength: r.strength.toFixed(6),
          rank: r.rank,
          ciLow: bounds.low.toFixed(6),
          ciHigh: bounds.high.toFixed(6),
        });
      }
    });
  }

  async getRankings(eventId: string, trackId: string) {
    const rows = await this.db
      .select()
      .from(pairwiseRankings)
      .where(and(eq(pairwiseRankings.eventId, eventId), eq(pairwiseRankings.trackId, trackId)))
      .orderBy(desc(pairwiseRankings.computedAt));

    return latestByKey(rows, (r) => r.submissionId);
  }
}
