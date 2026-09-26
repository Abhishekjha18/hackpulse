import { pgEnum } from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "registration_open",
  "submissions_open",
  "judging",
  "results_published",
  "archived",
]);

export const galleryVisibilityEnum = pgEnum("gallery_visibility", [
  "open",
  "participants_only",
  "hidden",
]);

export const votingModeEnum = pgEnum("voting_mode", ["disabled", "single_vote", "quadratic"]);
export const votingAccessEnum = pgEnum("voting_access", [
  "open_link",
  "email_gated",
  "authenticated",
]);
export const scoringModeEnum = pgEnum("scoring_mode", ["rubric", "pairwise"]);

export const eventRoleEnum = pgEnum("event_role", ["organizer", "judge"]);

export const judgeInviteStatusEnum = pgEnum("judge_invite_status", [
  "pending",
  "accepted",
  "declined",
]);

export const customQuestionTypeEnum = pgEnum("custom_question_type", [
  "text",
  "long_text",
  "url",
  "number",
  "single_select",
  "multi_select",
]);

export const submissionStatusEnum = pgEnum("submission_status", ["draft", "submitted"]);

export const judgeAssignmentStatusEnum = pgEnum("judge_assignment_status", [
  "assigned",
  "in_progress",
  "completed",
]);

export const draftSubmittedStatusEnum = pgEnum("draft_submitted_status", ["draft", "submitted"]);

export const normalizationMethodEnum = pgEnum("normalization_method", ["z_score", "min_max"]);

export const pairwiseWinnerEnum = pgEnum("pairwise_winner", ["a", "b", "tie"]);

export const certificateTypeEnum = pgEnum("certificate_type", ["participation", "winner", "judge"]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "succeeded",
  "failed",
]);
