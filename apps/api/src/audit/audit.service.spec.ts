import { createHash } from "node:crypto";

import type { Database } from "../db/client";
import { auditLogEntries } from "../db/schema/audit.schema";
import { user } from "../db/schema/auth.schema";
import { tracks } from "../db/schema/events.schema";
import { submissions } from "../db/schema/submissions.schema";
import { AuditService, canonicalStringify } from "./audit.service";

const GENESIS_HASH = "0".repeat(64);

interface Row {
  id: string;
  eventId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
  createdAt: Date;
}

function hashOf(row: Omit<Row, "id" | "entryHash" | "createdAt">): string {
  const canonical = canonicalStringify({
    eventId: row.eventId,
    actorUserId: row.actorUserId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
    prevHash: row.prevHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function makeChain(eventId: string, actions: string[]): Row[] {
  const rows: Row[] = [];
  let prevHash = GENESIS_HASH;
  for (const [i, action] of actions.entries()) {
    const base = {
      eventId,
      actorUserId: "user-1",
      action,
      resourceType: "test",
      resourceId: `r${i}`,
      metadata: {},
      prevHash,
    };
    const entryHash = hashOf(base);
    rows.push({
      id: `id-${i}`,
      ...base,
      entryHash,
      createdAt: new Date(Date.UTC(2026, 8, 28, 14, 22, i)),
    });
    prevHash = entryHash;
  }
  return rows;
}

function makeDb(rows: Row[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as Database;
}

describe("AuditService.verifyChain", () => {
  it("validates an untampered chain", async () => {
    const rows = makeChain("event-1", ["score.submit", "result.publish"]);
    const service = new AuditService(makeDb(rows));
    await expect(service.verifyChain("event-1")).resolves.toEqual({
      valid: true,
      entriesChecked: 2,
    });
  });

  it("detects a rewritten entry (content changed after the fact)", async () => {
    const rows = makeChain("event-1", ["score.submit", "result.publish"]);
    rows[0].metadata = { tampered: true }; // hash no longer matches content
    const service = new AuditService(makeDb(rows));
    const result = await service.verifyChain("event-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/entryHash/);
  });

  it("detects a deleted/reordered entry (broken prevHash link)", async () => {
    const rows = makeChain("event-1", ["a", "b", "c"]);
    rows.splice(1, 1); // remove the middle entry: link from a→c is now broken
    const service = new AuditService(makeDb(rows));
    const result = await service.verifyChain("event-1");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/prevHash/);
  });

  it("is unaffected by jsonb reordering metadata keys on read", async () => {
    // jsonb doesn't preserve key insertion order: compute the hash against
    // metadata in one key order, then verify a "row read back" with the
    // same values in a different key order, content unchanged, order changed.
    const base = {
      eventId: "event-1",
      actorUserId: "user-1",
      action: "vote.cast",
      resourceType: "submission",
      resourceId: "sub-1",
      metadata: { votesCast: 4, cost: 2, voterId: "anon:abc" },
      prevHash: GENESIS_HASH,
    };
    const entryHash = hashOf(base);

    const reorderedMetadata = { voterId: "anon:abc", cost: 2, votesCast: 4 };
    expect(Object.keys(reorderedMetadata)).not.toEqual(Object.keys(base.metadata));

    const row: Row = {
      id: "id-0",
      ...base,
      metadata: reorderedMetadata,
      entryHash,
      createdAt: new Date(),
    };
    const service = new AuditService(makeDb([row]));
    await expect(service.verifyChain("event-1")).resolves.toEqual({
      valid: true,
      entriesChecked: 1,
    });
  });

  it("accepts an empty chain", async () => {
    const service = new AuditService(makeDb([]));
    await expect(service.verifyChain("event-1")).resolves.toEqual({
      valid: true,
      entriesChecked: 0,
    });
  });
});

function makeListDb(
  auditRows: Row[],
  userRows: { id: string; name: string }[],
  submissionRows: { id: string; name: string }[] = [],
  trackRows: { id: string; name: string }[] = [],
) {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === auditLogEntries) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve(auditRows),
              }),
            }),
          };
        }
        if (table === user) {
          return { where: () => Promise.resolve(userRows) };
        }
        if (table === submissions) {
          return { where: () => Promise.resolve(submissionRows) };
        }
        if (table === tracks) {
          return { where: () => Promise.resolve(trackRows) };
        }
        throw new Error("makeListDb: unexpected table in .from()");
      },
    }),
  } as unknown as Database;
}

describe("AuditService.list", () => {
  it("resolves the actor's name and returns it alongside the raw row", async () => {
    const rows = makeChain("event-1", ["score.submit"]);
    const service = new AuditService(makeListDb(rows, [{ id: "user-1", name: "Priya Sharma" }]));
    const result = await service.list("event-1", {});
    expect(result.items[0].actorName).toBe("Priya Sharma");
    expect(result.items[0].actionLabel).toBe("Submitted a score");
    // Raw fields are still present — existing consumers reading .action etc. don't break.
    expect(result.items[0].action).toBe("score.submit");
  });

  it("resolves nothing and still returns a usable shape when no rows have an actor", async () => {
    const rows = makeChain("event-1", ["vote.cast"]).map((r) => ({ ...r, actorUserId: null }));
    const service = new AuditService(makeListDb(rows, []));
    const result = await service.list("event-1", {});
    expect(result.items[0].actorName).toBe("Anonymous");
  });
});
