import { INVITE_STATUS, JUDGE_ASSIGNMENT_STATUS, SCORE_STATUS } from "@hackpulse/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import {
  draftSubmittedStatusEnum,
  eventRoleEnum,
  judgeAssignmentStatusEnum,
  judgeInviteStatusEnum,
  normalizationMethodEnum,
  pairwiseWinnerEnum,
} from "./enums";
import { events, tracks } from "./events.schema";
import { submissions } from "./submissions.schema";
// FR-JASSIGN / co-organizer invites, sharing one table and state machine
// (role column) rather than reimplementing pending/accept/decline twice.
// A pending or declined invite grants nothing: event_roles/judge_track_scopes
// only get inserted on acceptance, which is also what keeps it invisible to
// algorithmic assignment's judge pool with no separate exclusion logic
// needed. trackIds only means anything for a judge invite; a co-organizer
// invite always has trackIds: []. unique() includes role since a person
// could plausibly hold two separate open invites on the same event.
export const eventInvites = pgTable(
  "event_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    inviteeUserId: text("invitee_user_id")
      .notNull()
      .references(() => user.id),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    role: eventRoleEnum("role").notNull(),
    trackIds: jsonb("track_ids").$type<string[]>().notNull(),
    status: judgeInviteStatusEnum("status").notNull().default(INVITE_STATUS.PENDING),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [unique().on(table.eventId, table.inviteeUserId, table.role)],
);

// FR-JASSIGN
export const judgeAssignments = pgTable(
  "judge_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    judgeUserId: text("judge_user_id")
      .notNull()
      .references(() => user.id),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    status: judgeAssignmentStatusEnum("status").notNull().default(JUDGE_ASSIGNMENT_STATUS.ASSIGNED),
    assignedByUserId: text("assigned_by_user_id")
      .notNull()
      .references(() => user.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.judgeUserId, table.submissionId),
    // "My queue" (AssignmentsService.getQueue) and the dashboard progress
    // table both filter by judge and status.
    index("judge_assignments_judge_status_idx").on(table.judgeUserId, table.status),
  ],
);

// FR-SCORE-01
export const rubrics = pgTable("rubrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  trackId: uuid("track_id").references(() => tracks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scaleMin: integer("scale_min").notNull().default(1),
  scaleMax: integer("scale_max").notNull().default(5),
  // A rubric with scores against it can't be hard-deleted, since that would
  // destroy judging data. Archiving is the way out: it stops being offered
  // for new scoring while every existing score stays intact and traceable.
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rubricCriteria = pgTable("rubric_criteria", {
  id: uuid("id").primaryKey().defaultRandom(),
  rubricId: uuid("rubric_id")
    .notNull()
    .references(() => rubrics.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  weight: numeric("weight", { precision: 5, scale: 4 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

// FR-SCORE-02..05
export const scores = pgTable(
  "scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    judgeAssignmentId: uuid("judge_assignment_id")
      .notNull()
      .unique()
      .references(() => judgeAssignments.id, { onDelete: "cascade" }),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubrics.id),
    status: draftSubmittedStatusEnum("status").notNull().default(SCORE_STATUS.DRAFT),
    rawWeightedScore: numeric("raw_weighted_score", { precision: 6, scale: 3 }),
    overallFeedback: text("overall_feedback"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // NormalizationService.recompute reads only submitted scores per
    // rubric, so this partial index means the much larger set of
    // draft/in-progress scores never has to be scanned or indexed for it.
    index("scores_rubric_submitted_idx")
      .on(table.rubricId, table.status)
      .where(sql`${table.status} = 'submitted'`),
  ],
);

export const criterionScores = pgTable(
  "criterion_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scoreId: uuid("score_id")
      .notNull()
      .references(() => scores.id, { onDelete: "cascade" }),
    rubricCriterionId: uuid("rubric_criterion_id")
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: "cascade" }),
    value: numeric("value", { precision: 4, scale: 2 }).notNull(),
    feedback: text("feedback"),
  },
  (table) => [unique().on(table.scoreId, table.rubricCriterionId)],
);

// FR-SCORE-05, NFR-AUDIT-01: raw scores are never overwritten in place.
export const scoreRevisions = pgTable("score_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoreId: uuid("score_id")
    .notNull()
    .references(() => scores.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  revisedByUserId: text("revised_by_user_id")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// FR-NORM: recomputation inserts a new row; latest wins, history retained.
export const normalizedResults = pgTable("normalized_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  rubricId: uuid("rubric_id")
    .notNull()
    .references(() => rubrics.id),
  method: normalizationMethodEnum("method").notNull(),
  rawMean: numeric("raw_mean", { precision: 6, scale: 3 }).notNull(),
  normalizedMean: numeric("normalized_mean", { precision: 6, scale: 3 }).notNull(),
  rank: integer("rank").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

// FR-PAIR
export const pairwiseComparisons = pgTable("pairwise_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  trackId: uuid("track_id")
    .notNull()
    .references(() => tracks.id),
  judgeUserId: text("judge_user_id")
    .notNull()
    .references(() => user.id),
  submissionAId: uuid("submission_a_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  submissionBId: uuid("submission_b_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  winner: pairwiseWinnerEnum("winner").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pairwiseRankings = pgTable("pairwise_rankings", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  trackId: uuid("track_id")
    .notNull()
    .references(() => tracks.id),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  btStrength: numeric("bt_strength", { precision: 10, scale: 6 }).notNull(),
  rank: integer("rank").notNull(),
  ciLow: numeric("ci_low", { precision: 10, scale: 6 }).notNull(),
  ciHigh: numeric("ci_high", { precision: 10, scale: 6 }).notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});
