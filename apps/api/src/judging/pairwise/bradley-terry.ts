import { PAIRWISE_WINNER } from "@hackpulse/shared";
/**
 * Bradley-Terry pairwise ranking, fit by minorization-maximization (Hunter,
 * 2004, "MM algorithms for generalized Bradley-Terry models"). This is
 * the Gavel/HackMIT approach (FR-PAIR, Pairwise Mode bonus): instead of
 * asking a judge for an absolute score, ask which of two projects is
 * better, and recover a global strength/ranking from the accumulated
 * comparisons. It sidesteps cross-judge calibration entirely: there is no
 * "judge's personal scale" to normalize, because no judge ever produces an
 * absolute number.
 *
 * Model: P(i beats j) = π_i / (π_i + π_j), π_i > 0. The MM update for item
 * i, given win counts W_i and per-opponent comparison counts n_ij, is
 *
 *   π_i ← W_i / Σ_j n_ij / (π_i + π_j)
 *
 * Ties are not part of classical Bradley-Terry; the common, defensible
 * simplification used here is to award each side half a win: a tie
 * neither helps nor hurts either item's relative strength on net, which is
 * the property you want from "the judge couldn't distinguish them."
 *
 * The model is identified only up to a multiplicative constant (doubling
 * every π_i changes nothing about the predicted win probabilities), so
 * each iteration renormalizes to a geometric mean of 1, an arbitrary but
 * stable choice of scale, purely for display; only the *ranking* and the
 * *ratios* between strengths are meaningful.
 *
 * Regularization: unregularized Bradley-Terry is degenerate for an item
 * with a *perfect* record (all wins or all losses): its maximum-likelihood
 * strength is unbounded, and on sparse early-event data (a project's first
 * comparison or two) that is the common case, not an edge case. Each item
 * gets one fictional win and one fictional loss against a phantom opponent
 * pinned at strength 1 (REGULARIZATION below controls how many). This is a
 * weak empirical-Bayes prior centered on "average" that only meaningfully
 * moves an estimate when real data is thin, and is what keeps a 1-0 record
 * from being stored as a strength of 10^18, the actual failure this fixes,
 * caught by a live end-to-end test rather than a unit test with tidy numbers.
 */
const REGULARIZATION = 1;

export interface Comparison {
  a: string;
  b: string;
  winner: "a" | "b" | "tie";
}

function buildModel(items: string[], comparisons: Comparison[]) {
  const opponents = new Map<string, Map<string, number>>();
  const wins = new Map<string, number>();
  for (const item of items) {
    opponents.set(item, new Map());
    wins.set(item, 0);
  }

  for (const c of comparisons) {
    if (!opponents.has(c.a) || !opponents.has(c.b) || c.a === c.b) {
      continue;
    }
    opponents.get(c.a)!.set(c.b, (opponents.get(c.a)!.get(c.b) ?? 0) + 1);
    opponents.get(c.b)!.set(c.a, (opponents.get(c.b)!.get(c.a) ?? 0) + 1);
    if (c.winner === PAIRWISE_WINNER.A) {
      wins.set(c.a, wins.get(c.a)! + 1);
    } else if (c.winner === PAIRWISE_WINNER.B) {
      wins.set(c.b, wins.get(c.b)! + 1);
    } else {
      wins.set(c.a, wins.get(c.a)! + 0.5);
      wins.set(c.b, wins.get(c.b)! + 0.5);
    }
  }

  return { opponents, wins };
}

/** Fits Bradley-Terry strengths for `items` given `comparisons` between
 * them. Items with zero comparisons keep strength 1 (the prior): there is
 * no information to move them, and they should not be reported as tied
 * for first by default sort order alone; callers should treat
 * zero-comparison items as "not yet rankable." */
export function fitBradleyTerry(
  items: string[],
  comparisons: Comparison[],
  iterations = 200,
): Map<string, number> {
  const { opponents, wins } = buildModel(items, comparisons);
  let pi = new Map(items.map((i) => [i, 1]));

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    const active: string[] = [];

    for (const i of items) {
      const oppMap = opponents.get(i)!;
      if (oppMap.size === 0) {
        // No data at all: pinned at the prior, excluded from the rescaling
        // below so it can never drift. An earlier version rescaled every
        // item, judged or not, by the geometric mean of all of them; since
        // only judged items actually move, that mean drifted from 1 as they
        // did, and an unjudged item's constant "1" numerator divided by a
        // shrinking denominator grew without bound. Caught by a unit test
        // asserting an unjudged item stays exactly at the prior.
        next.set(i, 1);
        continue;
      }
      active.push(i);
      // Phantom opponent: strength pinned at 1, contributing 2×REGULARIZATION
      // comparisons (one fictional win, one fictional loss) to the denominator.
      let denom = (2 * REGULARIZATION) / (pi.get(i)! + 1);
      for (const [j, nij] of oppMap) {
        denom += nij / (pi.get(i)! + pi.get(j)!);
      }
      const wi = wins.get(i)! + REGULARIZATION; // the fictional win
      next.set(i, denom > 0 ? Math.max(wi / denom, 1e-9) : pi.get(i)!);
    }

    if (active.length > 0) {
      const logSum = active.reduce((s, i) => s + Math.log(next.get(i)!), 0);
      const geoMean = Math.exp(logSum / active.length);
      for (const i of active) {
        next.set(i, next.get(i)! / geoMean);
      }
    }

    pi = next;
  }

  return pi;
}

export interface RankedItem {
  item: string;
  strength: number;
  comparisonCount: number;
  rank: number;
}

export function rank(items: string[], comparisons: Comparison[], iterations = 200): RankedItem[] {
  const strengths = fitBradleyTerry(items, comparisons, iterations);
  const { opponents } = buildModel(items, comparisons);

  const counts = new Map<string, number>();
  for (const item of items) {
    let n = 0;
    for (const c of opponents.get(item)!.values()) {
      n += c;
    }
    counts.set(item, n);
  }

  return items
    .map((item) => ({ item, strength: strengths.get(item)!, comparisonCount: counts.get(item)! }))
    .sort((a, b) => b.strength - a.strength)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/** FR-PAIR-04 — ranking uncertainty via the percentile bootstrap: refit on
 * `samples` resamplings-with-replacement of the observed comparisons and
 * report the 2.5th/97.5th percentile of each item's strength. */
export function bootstrapConfidenceIntervals(
  items: string[],
  comparisons: Comparison[],
  { iterations = 100, samples = 100 }: { iterations?: number; samples?: number } = {},
): Map<string, { low: number; high: number }> {
  const draws = new Map<string, number[]>(items.map((i) => [i, []]));

  for (let s = 0; s < samples; s++) {
    const resample: Comparison[] = [];
    for (let i = 0; i < comparisons.length; i++) {
      resample.push(comparisons[Math.floor(Math.random() * comparisons.length)]);
    }
    const fit = fitBradleyTerry(items, resample, iterations);
    for (const item of items) {
      draws.get(item)!.push(fit.get(item) ?? 1);
    }
  }

  const result = new Map<string, { low: number; high: number }>();
  for (const item of items) {
    const values = draws.get(item)!.sort((a, b) => a - b);
    const low = values[Math.floor(0.025 * values.length)];
    const high = values[Math.min(Math.ceil(0.975 * values.length), values.length - 1)];
    result.set(item, { low, high });
  }
  return result;
}
