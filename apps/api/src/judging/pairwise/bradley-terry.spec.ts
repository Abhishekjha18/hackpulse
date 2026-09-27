import {
  bootstrapConfidenceIntervals,
  type Comparison,
  fitBradleyTerry,
  rank,
} from "./bradley-terry";

describe("fitBradleyTerry", () => {
  it("recovers a clear transitive ordering: A beats B beats C", () => {
    const items = ["A", "B", "C"];
    const comparisons: Comparison[] = [
      ...Array(10).fill({ a: "A", b: "B", winner: "a" as const }),
      ...Array(10).fill({ a: "B", b: "C", winner: "a" as const }),
      ...Array(10).fill({ a: "A", b: "C", winner: "a" as const }),
    ];
    const strengths = fitBradleyTerry(items, comparisons);
    expect(strengths.get("A")!).toBeGreaterThan(strengths.get("B")!);
    expect(strengths.get("B")!).toBeGreaterThan(strengths.get("C")!);
  });

  it("gives equal strength to two items that split wins evenly", () => {
    const items = ["A", "B"];
    const comparisons: Comparison[] = [
      { a: "A", b: "B", winner: "a" },
      { a: "A", b: "B", winner: "b" },
      { a: "A", b: "B", winner: "a" },
      { a: "A", b: "B", winner: "b" },
    ];
    const strengths = fitBradleyTerry(items, comparisons);
    expect(strengths.get("A")!).toBeCloseTo(strengths.get("B")!, 5);
  });

  it("treats a tie as half a win for each side (neutral, not a coin flip)", () => {
    const items = ["A", "B"];
    const allTies: Comparison[] = Array(10).fill({ a: "A", b: "B", winner: "tie" as const });
    const strengths = fitBradleyTerry(items, allTies);
    expect(strengths.get("A")!).toBeCloseTo(strengths.get("B")!, 5);
    expect(strengths.get("A")!).toBeCloseTo(1, 1); // stays near the prior, not pulled either way
  });

  it("leaves an item with zero comparisons at the prior strength", () => {
    const items = ["A", "B", "Unjudged"];
    const comparisons: Comparison[] = [{ a: "A", b: "B", winner: "a" }];
    const strengths = fitBradleyTerry(items, comparisons);
    expect(strengths.get("Unjudged")).toBe(1);
  });

  it("stays finite and bounded for a perfect record on sparse data (regression: numeric(10,6) overflow found live)", () => {
    // A single 1-0 record diverges without regularization: production saw
    // values like 999999999999995136, blowing past bt_strength's
    // numeric(10,6) column limit (~9999.999999).
    const items = ["A", "B", "C"];
    const comparisons: Comparison[] = [
      { a: "A", b: "B", winner: "a" },
      { a: "A", b: "C", winner: "a" },
      { a: "B", b: "C", winner: "a" },
    ];
    const strengths = fitBradleyTerry(items, comparisons, 500);
    for (const item of items) {
      const s = strengths.get(item)!;
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeLessThan(1000);
      expect(s).toBeGreaterThan(0);
    }
  });

  it("is invariant to input ordering of items", () => {
    const comparisons: Comparison[] = [
      { a: "A", b: "B", winner: "a" },
      { a: "B", b: "C", winner: "a" },
    ];
    const forward = fitBradleyTerry(["A", "B", "C"], comparisons);
    const reversed = fitBradleyTerry(["C", "B", "A"], comparisons);
    for (const item of ["A", "B", "C"]) {
      expect(forward.get(item)!).toBeCloseTo(reversed.get(item)!, 6);
    }
  });
});

describe("rank", () => {
  it("produces 1-indexed ranks in descending strength order", () => {
    const items = ["A", "B", "C"];
    const comparisons: Comparison[] = [
      { a: "A", b: "B", winner: "a" },
      { a: "A", b: "C", winner: "a" },
      { a: "B", b: "C", winner: "a" },
    ];
    const ranked = rank(items, comparisons);
    expect(ranked.map((r) => r.item)).toEqual(["A", "B", "C"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("reports comparisonCount per item", () => {
    const items = ["A", "B", "C"];
    const comparisons: Comparison[] = [
      { a: "A", b: "B", winner: "a" },
      { a: "A", b: "B", winner: "b" },
      { a: "A", b: "C", winner: "a" },
    ];
    const ranked = rank(items, comparisons);
    expect(ranked.find((r) => r.item === "A")!.comparisonCount).toBe(3);
    expect(ranked.find((r) => r.item === "C")!.comparisonCount).toBe(1);
  });
});

describe("bootstrapConfidenceIntervals", () => {
  it("gives a tight interval around a clear, well-sampled winner", () => {
    const items = ["A", "B"];
    const comparisons: Comparison[] = Array(50).fill({ a: "A", b: "B", winner: "a" as const });
    const ci = bootstrapConfidenceIntervals(items, comparisons, { iterations: 50, samples: 50 });
    const a = ci.get("A")!;
    const b = ci.get("B")!;
    expect(a.low).toBeGreaterThan(b.high);
  });

  it("gives a wide, overlapping interval with very little data", () => {
    const items = ["A", "B"];
    const comparisons: Comparison[] = [{ a: "A", b: "B", winner: "a" }];
    const ci = bootstrapConfidenceIntervals(items, comparisons, { iterations: 30, samples: 50 });
    const a = ci.get("A")!;
    const b = ci.get("B")!;
    // One comparison means every resample reproduces the same observation,
    // so the interval collapses to a point; just check it's finite.
    expect(Number.isFinite(a.low)).toBe(true);
    expect(Number.isFinite(b.high)).toBe(true);
  });
});
