import { SUBMISSION_STATUS } from "@hackpulse/shared";

import type { Database } from "../db/client";
import { CsvImportService } from "./csv-import.service";

// select().from().where() resolves to the next queued result set; insert()
// records what was written.
function fakeDb(selects: unknown[][]) {
  const queue = [...selects];
  const inserted: Record<string, unknown>[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(queue.shift() ?? []) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      },
    }),
  };
  return { db: db as unknown as Database, inserted };
}

// Found while preparing a demo: imported submissions were inserted with the
// column default ("draft"), and judge assignment and the judging queue only
// consider submitted projects, so an imported event had nothing to judge.
describe("CsvImportService submissions import", () => {
  it("imports each submission as submitted, with a submittedAt timestamp", async () => {
    const { db, inserted } = fakeDb([
      [{ id: "event" }], // event lookup
      [{ id: "team" }], // team by name
      [{ id: "track" }], // track by name
      [], // no existing submission for (team, track)
    ]);
    const report = await new CsvImportService(db).import("event", "submissions", [
      { teamName: "Team A", trackName: "AI/ML", name: "Project A" },
    ]);

    expect(report.succeeded).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe(SUBMISSION_STATUS.SUBMITTED);
    expect(inserted[0].submittedAt).toBeInstanceOf(Date);
  });
});
