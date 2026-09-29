import { annotateRevisions } from "./revision-history.util";

const snap = (raw: string | null, values: Record<string, string>) => ({
  rawWeightedScore: raw,
  criterionScores: Object.entries(values).map(([rubricCriterionId, value]) => ({
    rubricCriterionId,
    value,
  })),
});

describe("annotateRevisions", () => {
  it("chains before/after raw scores through successive edits", () => {
    const rows = [
      {
        id: "r1",
        scoreId: "s1",
        createdAt: new Date("2026-01-01T10:00:00Z"),
        snapshot: snap("1.700", { a: "1.00" }),
      },
      {
        id: "r2",
        scoreId: "s1",
        createdAt: new Date("2026-01-01T11:00:00Z"),
        snapshot: snap("2.500", { a: "5.00" }),
      },
    ];
    const out = annotateRevisions(rows, new Map([["s1", "3.700"]]));
    expect(out.map((r) => [r.id, r.rawScoreBefore, r.rawScoreAfter])).toEqual([
      ["r1", 1.7, 2.5],
      ["r2", 2.5, 3.7],
    ]);
  });

  it("reports which criteria changed", () => {
    const rows = [
      {
        id: "r1",
        scoreId: "s1",
        createdAt: new Date("2026-01-01T10:00:00Z"),
        snapshot: snap("2.000", { a: "2.00", b: "2.00" }),
      },
    ];
    const out = annotateRevisions(
      rows,
      new Map([["s1", "3.000"]]),
      new Map([["s1", { a: "2.00", b: "4.00" }]]),
    );
    expect(out[0].criterionChanges).toEqual([{ rubricCriterionId: "b", from: 2, to: 4 }]);
  });

  it("keeps different scores' histories separate", () => {
    const rows = [
      {
        id: "x",
        scoreId: "s1",
        createdAt: new Date("2026-01-01T10:00:00Z"),
        snapshot: snap("1.000", {}),
      },
      {
        id: "y",
        scoreId: "s2",
        createdAt: new Date("2026-01-01T10:30:00Z"),
        snapshot: snap("4.000", {}),
      },
    ];
    const out = annotateRevisions(
      rows,
      new Map([
        ["s1", "1.500"],
        ["s2", "4.500"],
      ]),
    );
    expect(out.find((r) => r.id === "x")!.rawScoreAfter).toBe(1.5);
    expect(out.find((r) => r.id === "y")!.rawScoreAfter).toBe(4.5);
  });
});
