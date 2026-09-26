import type { ProfileField } from "@hackpulse/shared";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";

// One row per user, created lazily on first PATCH, not at registration,
// since most users may never fill one in. `visibleFields` lists which
// PROFILE_FIELDS keys are public; everything not listed stays visible only
// to the owner and admins. Defaults to fully visible, since this is
// portfolio-style content people generally want seen, not opt-in-by-default
// private data.
export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  bio: text("bio").notNull().default(""),
  workplace: text("workplace").notNull().default(""),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  githubUrl: text("github_url"),
  linkedinUrl: text("linkedin_url"),
  websiteUrl: text("website_url"),
  visibleFields: jsonb("visible_fields")
    .$type<ProfileField[]>()
    .notNull()
    .default(["bio", "workplace", "skills", "githubUrl", "linkedinUrl", "websiteUrl"]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});
