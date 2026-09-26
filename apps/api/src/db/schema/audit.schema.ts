import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import { events } from "./events.schema";

// FR-ABUSE-05, NFR-AUDIT-02 — append-only, hash-chained. No UPDATE/DELETE
// grant exists for the application's database role against this table
// (enforced in the migration that creates it, not just by omitting routes).
export const auditLogEntries = pgTable(
  "audit_log_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    prevHash: text("prev_hash").notNull(),
    entryHash: text("entry_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Both AuditService.list (the readable log an organizer scrolls) and
  // verifyChain (recomputes the whole chain in creation order) filter by
  // partition and order by time — documented in DATA-MODEL.md, not
  // actually present in the schema until now.
  (table) => [index("audit_log_event_created_idx").on(table.eventId, table.createdAt)],
);
