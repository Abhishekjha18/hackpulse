import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditLogEntries, submissions, tracks, user } from "../db/schema";
import { DB } from "../db/tokens";
import { type AuditLogRow, describeAuditEntry, type NameLookups } from "./audit-format";

const GENESIS_HASH = "0".repeat(64);

/**
 * Postgres's `jsonb` doesn't preserve key insertion order, so `metadata`
 * read back after a round trip can reorder even though the values are
 * unchanged. Plain `JSON.stringify` is order-sensitive, which would make
 * every entry with metadata fail its own hash check after nothing more
 * than a read. Sorting keys recursively before stringifying makes the
 * hash a function of content, not of jsonb's storage representation.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`,
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable 32-bit hash of a string, used only to derive a Postgres advisory
 * lock key from an eventId: collisions just mean two unrelated events
 * briefly serialize on the same lock, which is harmless. */
function toLockKey(partition: string): number {
  let h = 2166136261;
  for (let i = 0; i < partition.length; i++) {
    h ^= partition.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export interface LogInput {
  eventId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

/**
 * FR-ABUSE-05 / NFR-AUDIT-02: append-only and hash-chained, partitioned
 * per event (instance-level actions with no eventId form their own
 * "GLOBAL" partition) so an organizer can verify their own event's log
 * without access to every other event on the instance. Concurrent writers
 * to the same partition are serialized with a Postgres advisory lock so
 * two appends can't race to read the same "last hash" and fork the chain.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async log(entry: LogInput) {
    const partition = entry.eventId ?? "GLOBAL";
    const lockKey = toLockKey(partition);

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

      const [last] = await tx
        .select({ entryHash: auditLogEntries.entryHash })
        .from(auditLogEntries)
        .where(
          entry.eventId
            ? eq(auditLogEntries.eventId, entry.eventId)
            : isNull(auditLogEntries.eventId),
        )
        .orderBy(desc(auditLogEntries.createdAt))
        .limit(1);

      const prevHash = last?.entryHash ?? GENESIS_HASH;
      const metadata = entry.metadata ?? {};
      const canonical = canonicalStringify({
        eventId: entry.eventId ?? null,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata,
        prevHash,
      });
      const entryHash = createHash("sha256").update(canonical).digest("hex");

      const [row] = await tx
        .insert(auditLogEntries)
        .values({
          eventId: entry.eventId ?? null,
          actorUserId: entry.actorUserId ?? null,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          metadata,
          prevHash,
          entryHash,
        })
        .returning();

      return row;
    });
  }

  // eventId: null reads the GLOBAL partition (site-wide actions with no
  // event of their own: auth, admin capability grants).
  async list(
    eventId: string | null,
    opts: { since?: Date; action?: string; cursor?: string; limit?: number },
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [
      eventId ? eq(auditLogEntries.eventId, eventId) : isNull(auditLogEntries.eventId),
    ];
    if (opts.action) {
      conditions.push(eq(auditLogEntries.action, opts.action));
    }
    if (opts.since) {
      conditions.push(sql`${auditLogEntries.createdAt} >= ${opts.since}`);
    }
    if (opts.cursor) {
      conditions.push(lt(auditLogEntries.createdAt, new Date(opts.cursor)));
    }

    const rows = await this.db
      .select()
      .from(auditLogEntries)
      .where(and(...conditions))
      .orderBy(desc(auditLogEntries.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const described = await this.describeEntries(items);
    return {
      items: described,
      nextCursor: hasMore ? items.at(-1)!.createdAt.toISOString() : null,
    };
  }

  // Read-side only: batches the id lookups every entry in a page might need
  // (actor, an event_role revoke's target, a score's submission, a denied
  // track) into three queries total, regardless of page size, then runs
  // every row through the pure formatter (audit-format.ts).
  private async describeEntries(rows: AuditLogRow[]) {
    const userIds = new Set<string>();
    const submissionIds = new Set<string>();
    const trackIds = new Set<string>();

    for (const row of rows) {
      if (row.actorUserId) {
        userIds.add(row.actorUserId);
      }
      if (row.resourceType === "user") {
        userIds.add(row.resourceId);
      }
      if (row.resourceType === "submission") {
        submissionIds.add(row.resourceId);
      }
      if (row.resourceType === "track") {
        trackIds.add(row.resourceId);
      }
      const metadata =
        row.metadata !== null && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      if (typeof metadata.targetUserId === "string") {
        userIds.add(metadata.targetUserId);
      }
      if (typeof metadata.submissionId === "string") {
        submissionIds.add(metadata.submissionId);
      }
    }

    const [userRows, submissionRows, trackRows] = await Promise.all([
      userIds.size > 0
        ? this.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, [...userIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
      submissionIds.size > 0
        ? this.db
            .select({ id: submissions.id, name: submissions.name })
            .from(submissions)
            .where(inArray(submissions.id, [...submissionIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
      trackIds.size > 0
        ? this.db
            .select({ id: tracks.id, name: tracks.name })
            .from(tracks)
            .where(inArray(tracks.id, [...trackIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const lookups: NameLookups = {
      userNames: new Map(userRows.map((r) => [r.id, r.name])),
      submissionNames: new Map(submissionRows.map((r) => [r.id, r.name])),
      trackNames: new Map(trackRows.map((r) => [r.id, r.name])),
    };

    return rows.map((row) => describeAuditEntry(row, lookups));
  }

  /** Recomputes every entry hash in creation order and confirms it matches
   * what's stored: the verifiable half of FR-ABUSE-05.
   * eventId: null verifies the GLOBAL partition. */
  async verifyChain(eventId: string | null) {
    const rows = await this.db
      .select()
      .from(auditLogEntries)
      .where(eventId ? eq(auditLogEntries.eventId, eventId) : isNull(auditLogEntries.eventId))
      .orderBy(asc(auditLogEntries.createdAt));

    let expectedPrev = GENESIS_HASH;
    for (const row of rows) {
      if (row.prevHash !== expectedPrev) {
        return { valid: false, brokenAt: row.id, reason: "prevHash does not match prior entry" };
      }
      const canonical = canonicalStringify({
        eventId: row.eventId,
        actorUserId: row.actorUserId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: row.metadata,
        prevHash: row.prevHash,
      });
      const recomputed = createHash("sha256").update(canonical).digest("hex");
      if (recomputed !== row.entryHash) {
        return { valid: false, brokenAt: row.id, reason: "entryHash does not match content" };
      }
      expectedPrev = row.entryHash;
    }

    return { valid: true, entriesChecked: rows.length };
  }
}
