import { seededShuffle } from "./seeded-shuffle";

describe("seededShuffle", () => {
  const items = ["a", "b", "c", "d", "e", "f", "g", "h"];

  it("is deterministic for the same seed", () => {
    const first = seededShuffle(items, "event-1|voter-1");
    const second = seededShuffle(items, "event-1|voter-1");
    expect(second).toEqual(first);
  });

  it("differs across voters (kills position bias)", () => {
    const a = seededShuffle(items, "event-1|voter-1");
    const b = seededShuffle(items, "event-1|voter-2");
    expect(a).not.toEqual(b);
  });

  it("is a permutation: same elements, same length", () => {
    const shuffled = seededShuffle(items, "event-1|voter-3");
    expect(shuffled).toHaveLength(items.length);
    expect([...shuffled].sort()).toEqual([...items].sort());
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    seededShuffle(items, "event-1|voter-4");
    expect(items).toEqual(copy);
  });
});
