import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client";
import { judgeAssignments, normalizedResults, scores, user } from "../db/schema";
import { DB } from "../db/tokens";
import { latestByKey } from "./latest-by-key.util";
import {
  computeJudgeStats,
  computeNormalizedRanking,
  detectOutlierJudges,
  groupByJudge,
} from "./normalization-math";

/**
 * Cross-judge normalization (FR-NORM). Method: per-judge z-score.
 *
 * Raw weighted scores are not comparable across judges: a judge who
 * scores everything a 4 and one who scores everything a 2 are not
 * necessarily disagreeing about quality, they may just anchor differently.
 * For each judge j, over every score they've submitted under this rubric,
 * compute their own mean μ_j and population standard deviation σ_j. A raw
 * score r from judge j normalizes to (r − μ_j) / σ_j, how many of *that
 * judge's own* standard deviations above or below their personal average
 * this particular score is. A submission's normalized score is the mean of
 * its normalized scores across every judge who scored it, which is what
 * gets ranked. σ_j = 0 (a judge who gave every score they've submitted the
 * same value) normalizes to 0: the "everyone's a 3" judge stops moving
 * anyone's rank rather than dividing by zero or being silently averaged in
 * at face value. JUDGING.md documents this as the deliberate answer to the
 * low-effort-judging failure mode named in the brief. See
 * `getNormalizationProof` for the raw-vs-normalized-vs-rank-change view.
 */
@Injectable()
export class NormalizationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Shared by recompute() and getOutlierJudges() below — both start from
  // the same "every submitted score for this rubric, joined to who judged
  // it" query and the same per-judge mean/stddev, then diverge on what
  // they do with it (aggregate per submission vs. flag the judge).
  private async fetchSubmittedScores(rubricId: string) {
    return this.db
      .select({
        rawWeightedScore: scores.rawWeightedScore,
        submissionId: judgeAssignments.submissionId,
        judgeUserId: judgeAssignments.judgeUserId,
      })
      .from(scores)
      .innerJoin(judgeAssignments, eq(judgeAssignments.id, scores.judgeAssignmentId))
      .where(and(eq(scores.rubricId, rubricId), eq(scores.status, "submitted")));
  }

  async recompute(rubricId: string) {
    const submitted = await this.fetchSubmittedScores(rubricId);
    if (submitted.length === 0) {
      return;
    }

    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const aggregated = computeNormalizedRanking(submitted, judgeStats);

    await this.db.transaction(async (tx) => {
      for (const a of aggregated) {
        await tx.insert(normalizedResults).values({
          submissionId: a.submissionId,
          rubricId,
          method: "z_score",
          rawMean: a.rawMean.toString(),
          normalizedMean: a.normalizedMean.toString(),
          rank: a.rank,
        });
      }
    });
  }

  /** Latest computed row per submission — recompute() is append-only, so
   * history survives, but only the most recent rank is "the" result. */
  async getResults(rubricId: string) {
    const rows = await this.db
      .select()
      .from(normalizedResults)
      .where(eq(normalizedResults.rubricId, rubricId))
      .orderBy(desc(normalizedResults.computedAt));

    return latestByKey(rows, (r) => r.submissionId);
  }

  // Normalization Proof bonus: raw scores, normalized scores, and the
  // ranking change side by side, on real data.
  async getNormalizationProof(rubricId: string) {
    const results = await this.getResults(rubricId);
    const byRawDesc = [...results].sort((a, b) => Number(b.rawMean) - Number(a.rawMean));
    const rawRank = new Map(byRawDesc.map((r, i) => [r.submissionId, i + 1]));

    return results.map((r) => ({
      submissionId: r.submissionId,
      rawMean: Number(r.rawMean),
      normalizedMean: Number(r.normalizedMean),
      rankByRawAlone: rawRank.get(r.submissionId)!,
      rankByNormalized: r.rank,
      rankChanged: rawRank.get(r.submissionId) !== r.rank,
    }));
  }

  // FR-NORM-04 — surfaces two independent signals for organizer review;
  // normalization already absorbs the *mathematical* effect of either one
  // (see the class doc), this is what lets a human decide whether to
  // actually talk to that judge. Recomputes per-judge z-scores the same
  // way recompute() does rather than reading normalizedResults back, since
  // that table only stores the aggregated per-submission mean, not each
  // judge's individual z-score that fed into it.
  async getOutlierJudges(rubricId: string) {
    const submitted = await this.fetchSubmittedScores(rubricId);
    if (submitted.length === 0) {
      return [];
    }

    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const flagged = detectOutlierJudges(submitted, judgeStats);
    if (flagged.length === 0) {
      return [];
    }

    const names = await this.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        inArray(
          user.id,
          flagged.map((f) => f.judgeUserId),
        ),
      );
    const nameById = new Map(names.map((n) => [n.id, n.name]));

    return flagged.map((f) => ({ ...f, judgeName: nameById.get(f.judgeUserId) ?? f.judgeUserId }));
  }
}
