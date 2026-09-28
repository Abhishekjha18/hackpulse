import {
  computeJudgeStats,
  computeNormalizedRanking,
  detectOutlierJudges,
  groupByJudge,
  type SubmittedScoreRow,
} from "./normalization-math";

describe("computeNormalizedRanking", () => {
  it("flips a raw-score ranking when judges anchor to different points on the scale (JUDGING.md worked example)", () => {
    // Judge 1: generous, scores Alpha higher than Beta. Judge 2: harsh, but
    // relatively favors Beta over Alpha. Raw averaging picks Beta (3.5 vs
    // 3.0); per-judge normalization should reveal a dead heat, because each
    // judge's own scale is what the raw gap actually reflects.
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "alpha", judgeUserId: "j1", rawWeightedScore: "5" },
      { submissionId: "beta", judgeUserId: "j1", rawWeightedScore: "4" },
      { submissionId: "alpha", judgeUserId: "j2", rawWeightedScore: "1" },
      { submissionId: "beta", judgeUserId: "j2", rawWeightedScore: "3" },
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const ranked = computeNormalizedRanking(submitted, judgeStats);

    const alpha = ranked.find((r) => r.submissionId === "alpha")!;
    const beta = ranked.find((r) => r.submissionId === "beta")!;

    expect(alpha.rawMean).toBeCloseTo(3.0, 5);
    expect(beta.rawMean).toBeCloseTo(3.5, 5);
    expect(alpha.normalizedMean).toBeCloseTo(0, 5);
    expect(beta.normalizedMean).toBeCloseTo(0, 5);
  });

  it("corrects a huge raw disparity between a lenient and a harsh judge who agree on relative order", () => {
    // Judge 1 scores everything 4-5, judge 2 scores everything 1-2, but both
    // rank Gamma above Delta. Raw means make this look close (judge 1's
    // scale swamps judge 2's); normalized means should show the same
    // consensus ordering both judges actually expressed.
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "gamma", judgeUserId: "lenient", rawWeightedScore: "5" },
      { submissionId: "delta", judgeUserId: "lenient", rawWeightedScore: "4" },
      { submissionId: "gamma", judgeUserId: "harsh", rawWeightedScore: "2" },
      { submissionId: "delta", judgeUserId: "harsh", rawWeightedScore: "1" },
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const ranked = computeNormalizedRanking(submitted, judgeStats);

    const gamma = ranked.find((r) => r.submissionId === "gamma")!;
    const delta = ranked.find((r) => r.submissionId === "delta")!;
    expect(gamma.normalizedMean).toBeGreaterThan(delta.normalizedMean);
    expect(gamma.rank).toBe(1);
    expect(delta.rank).toBe(2);
  });

  it("normalizes a zero-variance judge ('everyone's a 3') to 0 rather than dividing by zero", () => {
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "a", judgeUserId: "flat", rawWeightedScore: "3" },
      { submissionId: "b", judgeUserId: "flat", rawWeightedScore: "3" },
      { submissionId: "c", judgeUserId: "flat", rawWeightedScore: "3" },
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    expect(judgeStats.get("flat")!.stddev).toBe(0);

    const ranked = computeNormalizedRanking(submitted, judgeStats);
    for (const r of ranked) {
      expect(r.normalizedMean).toBe(0);
      expect(Number.isFinite(r.normalizedMean)).toBe(true);
    }
  });

  it("does not let a zero-variance judge move anyone's rank when combined with a discriminating judge", () => {
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "a", judgeUserId: "flat", rawWeightedScore: "3" },
      { submissionId: "b", judgeUserId: "flat", rawWeightedScore: "3" },
      { submissionId: "a", judgeUserId: "sharp", rawWeightedScore: "5" },
      { submissionId: "b", judgeUserId: "sharp", rawWeightedScore: "2" },
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const withFlat = computeNormalizedRanking(submitted, judgeStats);

    const sharpOnly = submitted.filter((s) => s.judgeUserId === "sharp");
    const sharpStats = computeJudgeStats(groupByJudge(sharpOnly));
    const withoutFlat = computeNormalizedRanking(sharpOnly, sharpStats);

    expect(withFlat.find((r) => r.submissionId === "a")!.rank).toBe(
      withoutFlat.find((r) => r.submissionId === "a")!.rank,
    );
    expect(withFlat.find((r) => r.submissionId === "b")!.rank).toBe(
      withoutFlat.find((r) => r.submissionId === "b")!.rank,
    );
  });

  it("handles incomplete batches: a submission scored by fewer judges than another still aggregates correctly", () => {
    // j1 scored all three submissions; j2 only got through two before
    // judging closed. Each submission's normalized mean should be the mean
    // over whichever judges actually scored it, not a fixed judge count.
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "a", judgeUserId: "j1", rawWeightedScore: "5" },
      { submissionId: "b", judgeUserId: "j1", rawWeightedScore: "3" },
      { submissionId: "c", judgeUserId: "j1", rawWeightedScore: "1" },
      { submissionId: "a", judgeUserId: "j2", rawWeightedScore: "4" },
      { submissionId: "b", judgeUserId: "j2", rawWeightedScore: "2" },
      // j2 never reached "c"
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const ranked = computeNormalizedRanking(submitted, judgeStats);

    expect(ranked).toHaveLength(3);
    const c = ranked.find((r) => r.submissionId === "c")!;
    // c's normalized mean is j1's z-score alone, not averaged against a
    // missing second judge (no NaN, no silent zero-fill).
    expect(Number.isFinite(c.normalizedMean)).toBe(true);
    expect(c.rank).toBe(3); // j1's lowest score, and nothing pulls it up
  });

  it("assigns dense 1..n ranks in descending normalized order", () => {
    const submitted: SubmittedScoreRow[] = [
      { submissionId: "a", judgeUserId: "j1", rawWeightedScore: "5" },
      { submissionId: "b", judgeUserId: "j1", rawWeightedScore: "3" },
      { submissionId: "c", judgeUserId: "j1", rawWeightedScore: "1" },
    ];
    const judgeStats = computeJudgeStats(groupByJudge(submitted));
    const ranked = computeNormalizedRanking(submitted, judgeStats);
    expect(ranked.map((r) => r.submissionId)).toEqual(["a", "b", "c"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("uninformative judges (F5 regression, found live)", () => {
  // Live repro: two honest judges unanimously rank Q1 first; a third judge
  // assigned only Q1 gives it a flat 3. Averaging that judge's z=0 into
  // Q1's mean dragged the unanimous winner to rank 2.
  const honest = [90, 85, 50, 40, 30];
  const rows = (judgeUserId: string): SubmittedScoreRow[] =>
    honest.map((v, i) => ({
      submissionId: `q${i + 1}`,
      judgeUserId,
      rawWeightedScore: String(v),
    }));

  it("does not let a single-score judge demote the unanimous winner", () => {
    const submitted: SubmittedScoreRow[] = [
      ...rows("honest1"),
      ...rows("honest2"),
      { submissionId: "q1", judgeUserId: "flat", rawWeightedScore: "3" },
    ];
    const ranked = computeNormalizedRanking(submitted, computeJudgeStats(groupByJudge(submitted)));
    expect(ranked[0].submissionId).toBe("q1");
    expect(ranked.map((r) => r.submissionId)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
  });

  it("does not let a multi-score all-3 judge shrink the submissions they touched", () => {
    const submitted: SubmittedScoreRow[] = [
      ...rows("honest1"),
      ...rows("honest2"),
      { submissionId: "q1", judgeUserId: "flat", rawWeightedScore: "3" },
      { submissionId: "q2", judgeUserId: "flat", rawWeightedScore: "3" },
    ];
    const withFlat = computeNormalizedRanking(
      submitted,
      computeJudgeStats(groupByJudge(submitted)),
    );
    const honestOnly = submitted.filter((s) => s.judgeUserId !== "flat");
    const without = computeNormalizedRanking(
      honestOnly,
      computeJudgeStats(groupByJudge(honestOnly)),
    );
    for (const r of without) {
      expect(withFlat.find((w) => w.submissionId === r.submissionId)!.normalizedMean).toBeCloseTo(
        r.normalizedMean,
        9,
      );
    }
  });

  it("gives a submission scored only by uninformative judges a neutral 0", () => {
    const submitted: SubmittedScoreRow[] = [
      ...rows("honest1"),
      { submissionId: "solo", judgeUserId: "flat", rawWeightedScore: "3" },
    ];
    const ranked = computeNormalizedRanking(submitted, computeJudgeStats(groupByJudge(submitted)));
    expect(ranked.find((r) => r.submissionId === "solo")!.normalizedMean).toBe(0);
  });

  it("flags a judge with too few scores for organizer review", () => {
    const submitted: SubmittedScoreRow[] = [
      ...rows("honest1"),
      { submissionId: "q1", judgeUserId: "one", rawWeightedScore: "3" },
    ];
    const flagged = detectOutlierJudges(submitted, computeJudgeStats(groupByJudge(submitted)));
    const one = flagged.find((f) => f.judgeUserId === "one");
    expect(one).toBeDefined();
    expect(one!.tooFewScores).toBe(true);
    expect(flagged.find((f) => f.judgeUserId === "honest1")).toBeUndefined();
  });
});

describe("detectOutlierJudges", () => {
  // Known-answer scenario from JUDGING.md §3: three judges broadly agree on
  // relative order, a fourth scores in the exact opposite order (should be
  // flagged for negative correlation), a fifth scores everything identically
  // (should be flagged for variance, not correlation, since an all-tied
  // series has no ordering signal to correlate at all).
  const items = ["a", "b", "c", "d", "e"];
  const aligned = (judgeUserId: string, values: number[]): SubmittedScoreRow[] =>
    items.map((submissionId, i) => ({
      submissionId,
      judgeUserId,
      rawWeightedScore: String(values[i]),
    }));

  const submitted: SubmittedScoreRow[] = [
    ...aligned("consensus1", [5, 4, 3, 2, 1]),
    ...aligned("consensus2", [4, 5, 2, 3, 1]),
    ...aligned("consensus3", [5, 3, 4, 2, 1]),
    ...aligned("opposite", [1, 2, 3, 4, 5]),
    ...aligned("flat", [3, 3, 3, 3, 3]),
  ];
  const judgeStats = computeJudgeStats(groupByJudge(submitted));
  const flagged = detectOutlierJudges(submitted, judgeStats);
  const byId = new Map(flagged.map((f) => [f.judgeUserId, f]));

  it("flags the judge scoring in exact opposite order to peer consensus", () => {
    const opposite = byId.get("opposite");
    expect(opposite).toBeDefined();
    expect(opposite!.divergesFromPeers).toBe(true);
    expect(opposite!.correlationWithPeers).toBeLessThan(-0.3);
    expect(opposite!.nearZeroVariance).toBe(false);
  });

  it("flags the identical-score judge for near-zero variance, not correlation", () => {
    const flat = byId.get("flat");
    expect(flat).toBeDefined();
    expect(flat!.nearZeroVariance).toBe(true);
    expect(flat!.divergesFromPeers).toBe(false);
    // No ordering signal at all, so correlation is reported as neutral (0),
    // not a spurious negative that would double-flag it as divergent too.
    expect(flat!.correlationWithPeers).toBe(0);
  });

  it("does not flag judges who agree with peer consensus", () => {
    expect(byId.get("consensus1")).toBeUndefined();
    expect(byId.get("consensus2")).toBeUndefined();
    expect(byId.get("consensus3")).toBeUndefined();
  });

  it("does not attempt a correlation claim with fewer than 3 shared submissions", () => {
    const sparse: SubmittedScoreRow[] = [
      { submissionId: "a", judgeUserId: "j1", rawWeightedScore: "5" },
      { submissionId: "b", judgeUserId: "j1", rawWeightedScore: "1" },
      { submissionId: "a", judgeUserId: "j2", rawWeightedScore: "1" },
      { submissionId: "b", judgeUserId: "j2", rawWeightedScore: "5" },
    ];
    const stats = computeJudgeStats(groupByJudge(sparse));
    const result = detectOutlierJudges(sparse, stats);
    // Only 2 shared submissions each, well below the 3-submission floor,
    // even though j1 and j2 disagree on every single one.
    for (const f of result) {
      expect(f.divergesFromPeers).toBe(false);
      expect(f.correlationWithPeers).toBeNull();
    }
  });

  it("does not crash or flag a solo judge with no peers to compare against", () => {
    const solo: SubmittedScoreRow[] = items.map((submissionId) => ({
      submissionId,
      judgeUserId: "onlyOne",
      rawWeightedScore: "3",
    }));
    const stats = computeJudgeStats(groupByJudge(solo));
    const result = detectOutlierJudges(solo, stats);
    // Flagged for near-zero variance (every score is 3), but never for
    // divergence: there are no peers on any shared submission to diverge
    // from.
    expect(result).toHaveLength(1);
    expect(result[0].nearZeroVariance).toBe(true);
    expect(result[0].divergesFromPeers).toBe(false);
  });
});
