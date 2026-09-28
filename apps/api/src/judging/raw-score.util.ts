// Pure raw-score math for ScoringService, split out so it can be tested
// against known answers (same reason normalization-math.ts is separate).

export interface WeightedCriterion {
  id: string;
  weight: string;
}

export interface StoredCriterionValue {
  rubricCriterionId: string;
  value: string;
}

// The raw weighted score is always derived from the *persisted* criterion
// rows, never from the request body. A post-submit edit may send only the
// criteria that changed; summing just those (what this used to do) gave a
// raw score that disagreed with the stored criteria, and that corrupted raw
// value fed straight into normalization.
export function weightedRawScore(
  criteria: WeightedCriterion[],
  stored: StoredCriterionValue[],
): number {
  const weightByCriterion = new Map(criteria.map((c) => [c.id, Number(c.weight)]));
  return stored.reduce(
    (sum, v) => sum + Number(v.value) * (weightByCriterion.get(v.rubricCriterionId) ?? 0),
    0,
  );
}

// A body naming the same criterion twice is ambiguous (which value wins?),
// and the old code scored both while storing only the last.
export function findDuplicateCriterionId(
  input: { rubricCriterionId: string }[],
): string | undefined {
  const seen = new Set<string>();
  for (const { rubricCriterionId } of input) {
    if (seen.has(rubricCriterionId)) {
      return rubricCriterionId;
    }
    seen.add(rubricCriterionId);
  }
  return undefined;
}
