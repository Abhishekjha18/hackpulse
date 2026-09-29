import {
  EVENT_STATUS,
  GALLERY_VISIBILITY,
  SCORING_MODE,
  VOTING_ACCESS,
  VOTING_MODE,
} from "@hackpulse/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import {
  customQuestionTypeEnum,
  eventRoleEnum,
  eventStatusEnum,
  galleryVisibilityEnum,
  scoringModeEnum,
  votingAccessEnum,
  votingModeEnum,
} from "./enums";
// FR-EVT
// Two lifecycle modes, requested explicitly: "automatic" (all six of the
// registration/submission/judging timestamps set, status computed from the
// clock — see EventsService.computeDisplayStatus) or "manual" (all six
// null, an organizer drives status by hand through a forward-only sequence
// — see EventsService's transition guard). Which mode an event is in is
// derived from whether these columns are null, not stored separately, so
// it can never drift out of sync with itself; the check constraint below
// is what stops a row ending up with some of the six set and others not,
// which neither mode's logic knows how to interpret.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Same posture as a submission's thumbnailUrl/galleryImageUrls: a URL an
    // organizer supplies, not a file upload; this app has no object storage
    // for user-supplied binaries anywhere else either.
    bannerImageUrl: text("banner_image_url"),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    timezone: text("timezone").notNull(),
    registrationOpenAt: timestamp("registration_open_at", { withTimezone: true }),
    registrationCloseAt: timestamp("registration_close_at", { withTimezone: true }),
    submissionOpenAt: timestamp("submission_open_at", { withTimezone: true }),
    submissionCloseAt: timestamp("submission_close_at", { withTimezone: true }),
    judgingOpenAt: timestamp("judging_open_at", { withTimezone: true }),
    judgingCloseAt: timestamp("judging_close_at", { withTimezone: true }),
    resultsPublishAt: timestamp("results_publish_at", { withTimezone: true }),
    status: eventStatusEnum("status").notNull().default(EVENT_STATUS.DRAFT),
    galleryVisibility: galleryVisibilityEnum("gallery_visibility")
      .notNull()
      .default(GALLERY_VISIBILITY.HIDDEN),
    votingMode: votingModeEnum("voting_mode").notNull().default(VOTING_MODE.DISABLED),
    votingAccess: votingAccessEnum("voting_access").notNull().default(VOTING_ACCESS.AUTHENTICATED),
    scoringMode: scoringModeEnum("scoring_mode").notNull().default(SCORING_MODE.RUBRIC),
    // FR-TEAM-02 (team size 1-4).
    maxTeamSize: integer("max_team_size").notNull().default(4),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "events_lifecycle_dates_all_or_none",
      sql`
        (${table.registrationOpenAt} IS NULL AND ${table.registrationCloseAt} IS NULL AND
         ${table.submissionOpenAt} IS NULL AND ${table.submissionCloseAt} IS NULL AND
         ${table.judgingOpenAt} IS NULL AND ${table.judgingCloseAt} IS NULL)
        OR
        (${table.registrationOpenAt} IS NOT NULL AND ${table.registrationCloseAt} IS NOT NULL AND
         ${table.submissionOpenAt} IS NOT NULL AND ${table.submissionCloseAt} IS NOT NULL AND
         ${table.judgingOpenAt} IS NOT NULL AND ${table.judgingCloseAt} IS NOT NULL)
      `,
    ),
  ],
);

// FR-ROLE, FR-JASSIGN-01 — organizer/judge grants. Participant status is
// implied by team membership, not stored here.
export const eventRoles = pgTable("event_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  role: eventRoleEnum("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable("tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

// FR-JASSIGN-01, FR-ROLE-03 — a judge with no row here is scoped to no
// tracks. Absence is a deny, never an implicit allow.
export const judgeTrackScopes = pgTable("judge_track_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventRoleId: uuid("event_role_id")
    .notNull()
    .references(() => eventRoles.id, { onDelete: "cascade" }),
  trackId: uuid("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
});

// Requested explicitly, after finding the system silently assumed exactly
// one winner per prize: winnerCount is how many ranked entries within this
// prize's scope (its track's rank if trackId is set, the event's overall
// rank if null) actually win it — e.g. "top 3 in AI/ML" or "top 3 overall"
// for a single-track event. Defaults to 1, preserving the prior implicit
// behavior for every existing prize.
export const prizes = pgTable(
  "prizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    winnerCount: integer("winner_count").notNull().default(1),
  },
  (table) => [check("prizes_winner_count_positive", sql`${table.winnerCount} >= 1`)],
);

export const customQuestions = pgTable("custom_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  type: customQuestionTypeEnum("type").notNull(),
  options: jsonb("options").$type<string[] | null>(),
  required: boolean("required").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});
