// Turns raw score_revisions rows (each a snapshot of the score *before* an
// edit) into a readable timeline. The table was write-only from the API
// (F7): an audit entry said "score.edit" but nothing exposed what changed.

interface SnapshotShape {
  rawWeightedScore: string | null;
  criterionScores?: { rubricCriterionId: string; value: string }[];
}

export interface RevisionRow {
  id: string;
  scoreId: string;
  createdAt: Date;
  snapshot: unknown;
}

export interface CriterionChange {
  rubricCriterionId: string;
  from: number;
  to: number;
}

export interface AnnotatedRevision {
  id: string;
  scoreId: string;
  createdAt: Date;
  rawScoreBefore: number | null;
  rawScoreAfter: number | null;
  criterionChanges: CriterionChange[];
}

const toNumber = (v: string | null | undefined) =>
  v === null || v === undefined ? null : Number(v);

const valuesOf = (snapshot: SnapshotShape) =>
  new Map((snapshot.criterionScores ?? []).map((c) => [c.rubricCriterionId, Number(c.value)]));

/**
 * `currentRawByScoreId` is each score's live raw score; `currentValuesByScoreId`
 * (optional) its live per-criterion values. Both give the "after" of the
 * newest revision; older revisions take the next snapshot as their "after".
 */
export function annotateRevisions(
  rows: RevisionRow[],
  currentRawByScoreId: Map<string, string | null>,
  currentValuesByScoreId: Map<string, Record<string, string>> = new Map(),
): AnnotatedRevision[] {
  const byScore = new Map<string, RevisionRow[]>();
  for (const row of rows) {
    byScore.set(row.scoreId, [...(byScore.get(row.scoreId) ?? []), row]);
  }

  const out: AnnotatedRevision[] = [];
  for (const [scoreId, group] of byScore) {
    const ordered = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    ordered.forEach((row, i) => {
      const before = row.snapshot as SnapshotShape;
      const next = ordered[i + 1];
      const afterRaw = next
        ? toNumber((next.snapshot as SnapshotShape).rawWeightedScore)
        : toNumber(currentRawByScoreId.get(scoreId));

      const beforeValues = valuesOf(before);
      const afterValues = next
        ? valuesOf(next.snapshot as SnapshotShape)
        : new Map(
            Object.entries(currentValuesByScoreId.get(scoreId) ?? {}).map(([k, v]) => [
              k,
              Number(v),
            ]),
          );
      const criterionChanges: CriterionChange[] = [];
      for (const [rubricCriterionId, to] of afterValues) {
        const from = beforeValues.get(rubricCriterionId);
        if (from !== undefined && from !== to) {
          criterionChanges.push({ rubricCriterionId, from, to });
        }
      }

      out.push({
        id: row.id,
        scoreId,
        createdAt: row.createdAt,
        rawScoreBefore: toNumber(before.rawWeightedScore),
        rawScoreAfter: afterRaw,
        criterionChanges,
      });
    });
  }
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
