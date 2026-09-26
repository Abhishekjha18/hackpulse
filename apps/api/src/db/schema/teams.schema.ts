import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import { events } from "./events.schema";

// FR-TEAM
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id),
  inviteCode: text("invite_code").notNull().unique(),
  inviteCodeRegeneratedAt: timestamp("invite_code_regenerated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.teamId, table.userId)],
);
