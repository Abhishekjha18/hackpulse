import { findDuplicateCriterionId, weightedRawScore } from "./raw-score.util";

const criteria = [
  { id: "innov", weight: "0.5000" },
  { id: "exec", weight: "0.3000" },
  { id: "pres", weight: "0.2000" },
];

describe("weightedRawScore", () => {
  it("weights every stored criterion value", () => {
    const stored = [
      { rubricCriterionId: "innov", value: "5.00" },
      { rubricCriterionId: "exec", value: "2.00" },
      { rubricCriterionId: "pres", value: "3.00" },
    ];
    // F4 live repro: judge scored 1/2/3 (raw 1.7), then edited only
    // Innovation to 5. The stored row set is 5/2/3 and must give 3.7, not
    // the 2.5 you get from summing just the one criterion in the request.
    expect(weightedRawScore(criteria, stored)).toBeCloseTo(3.7, 9);
  });

  it("uses the stored (rounded) value, not what the client sent", () => {
    // numeric(4,2) stores 4.567 as 4.57; raw must agree with what's stored.
    const stored = [
      { rubricCriterionId: "innov", value: "4.57" },
      { rubricCriterionId: "exec", value: "2.00" },
      { rubricCriterionId: "pres", value: "3.00" },
    ];
    expect(weightedRawScore(criteria, stored)).toBeCloseTo(2.285 + 0.6 + 0.6, 9);
  });
});

describe("findDuplicateCriterionId", () => {
  it("returns the repeated criterion id", () => {
    expect(
      findDuplicateCriterionId([
        { rubricCriterionId: "innov" },
        { rubricCriterionId: "exec" },
        { rubricCriterionId: "innov" },
      ]),
    ).toBe("innov");
  });

  it("returns undefined when every criterion appears once", () => {
    expect(
      findDuplicateCriterionId([{ rubricCriterionId: "a" }, { rubricCriterionId: "b" }]),
    ).toBeUndefined();
  });
});
