import { CreateRubricInput } from "@hackpulse/shared";

const rubric = (...weights: number[]) => ({
  name: "r",
  criteria: weights.map((weight, i) => ({ name: `c${i}`, weight })),
});

// F1 (found live): a weight of 0.00001 passed validation and was stored as
// 0.0000, leaving a criterion shown to judges that can never affect the
// score; and any weight with more than 4 decimals silently changed on the
// way into numeric(5,4), so the sum that was validated is not the sum stored.
describe("CreateRubricInput weight precision", () => {
  it("accepts ordinary weights", () => {
    expect(CreateRubricInput.safeParse(rubric(0.5, 0.3, 0.2)).success).toBe(true);
    expect(CreateRubricInput.safeParse(rubric(0.3333, 0.3333, 0.3334)).success).toBe(true);
  });

  it("rejects a weight too small to survive numeric(5,4)", () => {
    expect(CreateRubricInput.safeParse(rubric(0.00001, 0.99999)).success).toBe(false);
  });

  it("rejects a weight with more than 4 decimal places", () => {
    expect(CreateRubricInput.safeParse(rubric(0.33333, 0.66667)).success).toBe(false);
  });

  it("accepts the smallest storable weight", () => {
    expect(CreateRubricInput.safeParse(rubric(0.0001, 0.9999)).success).toBe(true);
  });
});
