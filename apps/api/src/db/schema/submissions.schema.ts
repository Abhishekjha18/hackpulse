import { SUBMISSION_STATUS } from "@hackpulse/shared";
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import { submissionStatusEnum } from "./enums";
import { customQuestions, tracks } from "./events.schema";
import { teams } from "./teams.schema";
// FR-SUB
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tagline: text("tagline").notNull().default(""),
    description: text("description").notNull().default(""),
    thumbnailUrl: text("thumbnail_url"),
    galleryImageUrls: jsonb("gallery_image_urls").$type<string[]>().notNull().default([]),
    demoVideoUrl: text("demo_video_url"),
    repoUrl: text("repo_url"),
    liveUrl: text("live_url"),
    techTags: jsonb("tech_tags").$type<string[]>().notNull().default([]),
    status: submissionStatusEnum("status").notNull().default(SUBMISSION_STATUS.DRAFT),
    contentHash: text("content_hash"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FR-TEAM-03: one submission per team per track.
    unique().on(table.teamId, table.trackId),
    // Backs the gallery listing and judging-pool queries, both of which
    // filter by track and status together.
    index("submissions_track_status_idx").on(table.trackId, table.status),
  ],
);

// FR-SUB-04: audit trail of draft edits, independent of the judged version.
export const submissionRevisions = pgTable("submission_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  editedByUserId: text("edited_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customAnswers = pgTable(
  "custom_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    customQuestionId: uuid("custom_question_id")
      .notNull()
      .references(() => customQuestions.id, { onDelete: "cascade" }),
    value: jsonb("value"),
  },
  (table) => [unique().on(table.submissionId, table.customQuestionId)],
);
