// Shared by NormalizationService.getResults and PairwiseService.getRankings:
// both normalization and pairwise ranking are append-only (recompute()
// inserts a new row on every recomputation rather than updating in place,
// so history survives), and both only ever want the most recent row per
// submission, in rank order. `rowsDescByRecency` must already be ordered
// newest-first (each service's own `orderBy(desc(...computedAt))`); the
// first row seen per key here is kept as "the" current one.
export function latestByKey<T extends { rank: number }>(
  rowsDescByRecency: T[],
  key: (row: T) => string,
): T[] {
  const latest = new Map<string, T>();
  for (const row of rowsDescByRecency) {
    const k = key(row);
    if (!latest.has(k)) {
      latest.set(k, row);
    }
  }
  return [...latest.values()].sort((a, b) => a.rank - b.rank);
}
