import { integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import { events } from "./events.schema";
import { submissions } from "./submissions.schema";

// FR-VOTE: voterId is an authenticated user id, or a signed anonymous
// ballot id for open_link/email_gated modes, hence text, not a strict FK.
export const votes = pgTable(
  "votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    voterId: text("voter_id").notNull(),
    votesCast: integer("votes_cast").notNull().default(1),
    costPaid: numeric("cost_paid", { precision: 6, scale: 3 }).notNull().default("1"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.eventId, table.submissionId, table.voterId)],
);

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  authorLabel: text("author_label").notNull(),
  authorUserId: text("author_user_id").references(() => user.id),
  body: text("body").notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  hiddenByUserId: text("hidden_by_user_id").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
