// Pure cross-judge normalization math (FR-NORM), split out of
// NormalizationService so it can be unit tested directly against known
// answers, the same way bradley-terry.ts is tested apart from
// PairwiseService. See JUDGING.md §3 for the full mathematical writeup.

export interface SubmittedScoreRow {
  submissionId: string;
  judgeUserId: string;
  rawWeightedScore: string | null;
}

export interface JudgeStats {
  mean: number;
  stddev: number;
}

// Below this, a judge's per-submission z-scores are treated as identical
// for divergence purposes: avoids flagging "-0.28 vs -0.31" as somehow
// different from a true tie due to floating-point noise.
export const NEAR_ZERO_VARIANCE_THRESHOLD = 0.001;
// Fewer shared submissions than this and a correlation coefficient is
// mostly noise (with 2 points, correlation is always exactly +1 or -1).
export const MIN_SHARED_SUBMISSIONS_FOR_CORRELATION = 3;
// Pearson correlation below this between a judge's own z-scores and their
// peers' mean z-score on the same submissions is treated as "systematic
// divergence," not just disagreement.
export const DIVERGENCE_CORRELATION_THRESHOLD = -0.3;
// A judge's mean/stddev needs a handful of points to mean anything; below
// this the organizer is told so (FR-NORM-04), though the scores still count.
export const MIN_SCORES_FOR_RELIABLE_STATS = 3;

// A judge whose scores don't vary (every score identical, or only one score)
// gave no relative-quality signal, so there is nothing to normalize. Their
// z is 0 by definition, but that 0 must not be *averaged in*: it would drag
// every submission they touched toward the middle, which demotes a
// unanimous winner. Found live: one flat "3" on the frontrunner flipped
// rank 1 and 2 against two honest judges who agreed.
export function isInformative(stats: JudgeStats): boolean {
  return stats.stddev >= NEAR_ZERO_VARIANCE_THRESHOLD;
}

export function groupByJudge(submitted: SubmittedScoreRow[]): Map<string, number[]> {
  const byJudge = new Map<string, number[]>();
  for (const row of submitted) {
    const arr = byJudge.get(row.judgeUserId) ?? [];
    arr.push(Number(row.rawWeightedScore));
    byJudge.set(row.judgeUserId, arr);
  }
  return byJudge;
}

export function computeJudgeStats(byJudge: Map<string, number[]>): Map<string, JudgeStats> {
  const judgeStats = new Map<string, JudgeStats>();
  for (const [judgeId, values] of byJudge) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    judgeStats.set(judgeId, { mean, stddev: Math.sqrt(variance) });
  }
  return judgeStats;
}

export function zScore(raw: number, stats: JudgeStats): number {
  return stats.stddev === 0 ? 0 : (raw - stats.mean) / stats.stddev;
}

export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  // Either side has zero variance (e.g. a near-zero-variance judge, whose
  // z-scores are already flagged separately): no ordering signal to
  // correlate, so no divergence claim either way.
  if (varA === 0 || varB === 0) {
    return 0;
  }
  return cov / Math.sqrt(varA * varB);
}

export interface NormalizedSubmissionResult {
  submissionId: string;
  rawMean: number;
  normalizedMean: number;
  rank: number;
}

export function computeNormalizedRanking(
  submitted: SubmittedScoreRow[],
  judgeStats: Map<string, JudgeStats>,
): NormalizedSubmissionResult[] {
  const bySubmission = new Map<string, { raw: number[]; normalized: number[] }>();
  for (const row of submitted) {
    const raw = Number(row.rawWeightedScore);
    const stats = judgeStats.get(row.judgeUserId)!;
    const entry = bySubmission.get(row.submissionId) ?? { raw: [], normalized: [] };
    entry.raw.push(raw);
    if (isInformative(stats)) {
      entry.normalized.push(zScore(raw, stats));
    }
    bySubmission.set(row.submissionId, entry);
  }

  return [...bySubmission.entries()]
    .map(([submissionId, { raw, normalized }]) => ({
      submissionId,
      rawMean: raw.reduce((a, b) => a + b, 0) / raw.length,
      // No informative judge scored it: neutral 0 rather than NaN.
      normalizedMean:
        normalized.length === 0 ? 0 : normalized.reduce((a, b) => a + b, 0) / normalized.length,
    }))
    .sort((a, b) => b.normalizedMean - a.normalizedMean)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

export interface OutlierFlag {
  judgeUserId: string;
  scoreCount: number;
  nearZeroVariance: boolean;
  tooFewScores: boolean;
  divergesFromPeers: boolean;
  correlationWithPeers: number | null;
}

// FR-NORM-04: two independent signals for organizer review. Neither signal
// removes or adjusts a judge's scores; computeNormalizedRanking above
// already absorbs the mathematical effect of both. This is what lets a
// human decide whether to actually talk to that judge.
export function detectOutlierJudges(
  submitted: SubmittedScoreRow[],
  judgeStats: Map<string, JudgeStats>,
): OutlierFlag[] {
  const byJudge = groupByJudge(submitted);

  // z-score per (judge, submission), plus the inverse index (per
  // submission, every judge's z) needed to compute each judge's peers'
  // mean without them.
  const zByJudge = new Map<string, Map<string, number>>();
  const judgesBySubmission = new Map<string, { judgeUserId: string; z: number }[]>();
  for (const row of submitted) {
    const stats = judgeStats.get(row.judgeUserId)!;
    const z = zScore(Number(row.rawWeightedScore), stats);

    const inner = zByJudge.get(row.judgeUserId) ?? new Map();
    inner.set(row.submissionId, z);
    zByJudge.set(row.judgeUserId, inner);

    const peers = judgesBySubmission.get(row.submissionId) ?? [];
    peers.push({ judgeUserId: row.judgeUserId, z });
    judgesBySubmission.set(row.submissionId, peers);
  }

  const flagged: OutlierFlag[] = [];
  for (const judgeId of byJudge.keys()) {
    const stats = judgeStats.get(judgeId)!;
    const scoreCount = byJudge.get(judgeId)!.length;
    const nearZeroVariance = scoreCount >= 2 && stats.stddev < NEAR_ZERO_VARIANCE_THRESHOLD;
    const tooFewScores = scoreCount < MIN_SCORES_FOR_RELIABLE_STATS;

    const mine: number[] = [];
    const peerMeans: number[] = [];
    for (const [submissionId, z] of zByJudge.get(judgeId)!) {
      const others = judgesBySubmission.get(submissionId)!.filter((p) => p.judgeUserId !== judgeId);
      if (others.length === 0) {
        continue;
      }
      mine.push(z);
      peerMeans.push(others.reduce((s, p) => s + p.z, 0) / others.length);
    }

    let correlationWithPeers: number | null = null;
    let divergesFromPeers = false;
    if (mine.length >= MIN_SHARED_SUBMISSIONS_FOR_CORRELATION) {
      correlationWithPeers = pearsonCorrelation(mine, peerMeans);
      divergesFromPeers = correlationWithPeers < DIVERGENCE_CORRELATION_THRESHOLD;
    }

    if (nearZeroVariance || tooFewScores || divergesFromPeers) {
      flagged.push({
        judgeUserId: judgeId,
        scoreCount,
        nearZeroVariance,
        tooFewScores,
        divergesFromPeers,
        correlationWithPeers,
      });
    }
  }

  return flagged;
}
