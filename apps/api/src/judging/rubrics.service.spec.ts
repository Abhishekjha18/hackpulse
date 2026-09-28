import { ConflictException } from "@nestjs/common";

import type { Database } from "../db/client";
import { RubricsService } from "./rubrics.service";

// Minimal stand-in for the drizzle chain RubricsService.create uses:
// select().from().where() resolves to the next queued result set.
function fakeDb(selects: unknown[][]) {
  const queue = [...selects];
  const inserted: unknown[] = [];
  const chain = () => ({
    from: () => ({ where: () => Promise.resolve(queue.shift() ?? []) }),
  });
  const db = {
    select: chain,
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        insert: () => ({
          values: (v: unknown) => {
            inserted.push(v);
            return { returning: async () => [{ id: "new-rubric", ...(v as object) }] };
          },
        }),
      }),
  };
  return { db: db as unknown as Database, inserted };
}

const input = {
  name: "v2",
  trackId: "11111111-1111-4111-8111-111111111111",
  scaleMin: 1,
  scaleMax: 5,
  criteria: [{ name: "c", description: "", weight: 1 }],
};

// F2 (found live): a second active rubric for the same track was accepted
// and silently ignored, since scoring resolves one rubric per track. The
// organizer got a 201 for a rubric no judge would ever be shown.
describe("RubricsService.create duplicate active rubric", () => {
  it("rejects a second active rubric for the same track", async () => {
    const { db, inserted } = fakeDb([[{ id: "event" }], [{ id: "existing", name: "v1" }]]);
    await expect(new RubricsService(db).create("event", input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inserted).toHaveLength(0);
  });

  it("rejects a second active event-wide rubric", async () => {
    const { db } = fakeDb([[{ id: "event" }], [{ id: "existing", name: "v1" }]]);
    await expect(
      new RubricsService(db).create("event", { ...input, trackId: null }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("allows a rubric when none is active for that scope", async () => {
    const { db, inserted } = fakeDb([[{ id: "event" }], []]);
    await expect(new RubricsService(db).create("event", input)).resolves.toMatchObject({
      id: "new-rubric",
    });
    expect(inserted.length).toBeGreaterThan(0);
  });
});
