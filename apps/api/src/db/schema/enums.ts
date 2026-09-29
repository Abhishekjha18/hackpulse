import {
  CERTIFICATE_TYPE,
  CUSTOM_QUESTION_TYPE,
  EVENT_ROLE,
  EVENT_STATUS,
  GALLERY_VISIBILITY,
  INVITE_STATUS,
  JUDGE_ASSIGNMENT_STATUS,
  NORMALIZATION_METHOD,
  PAIRWISE_WINNER,
  SCORING_MODE,
  SUBMISSION_STATUS,
  VOTING_ACCESS,
  VOTING_MODE,
  WEBHOOK_DELIVERY_STATUS,
} from "@hackpulse/shared";
import { pgEnum } from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", [
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.REGISTRATION_OPEN,
  EVENT_STATUS.SUBMISSIONS_OPEN,
  EVENT_STATUS.JUDGING,
  EVENT_STATUS.RESULTS_PUBLISHED,
  EVENT_STATUS.ARCHIVED,
]);

export const galleryVisibilityEnum = pgEnum("gallery_visibility", [
  GALLERY_VISIBILITY.OPEN,
  GALLERY_VISIBILITY.PARTICIPANTS_ONLY,
  GALLERY_VISIBILITY.HIDDEN,
]);

export const votingModeEnum = pgEnum("voting_mode", [
  VOTING_MODE.DISABLED,
  VOTING_MODE.SINGLE_VOTE,
  VOTING_MODE.QUADRATIC,
]);
export const votingAccessEnum = pgEnum("voting_access", [
  VOTING_ACCESS.OPEN_LINK,
  VOTING_ACCESS.EMAIL_GATED,
  VOTING_ACCESS.AUTHENTICATED,
]);
export const scoringModeEnum = pgEnum("scoring_mode", [SCORING_MODE.RUBRIC, SCORING_MODE.PAIRWISE]);

export const eventRoleEnum = pgEnum("event_role", [EVENT_ROLE.ORGANIZER, EVENT_ROLE.JUDGE]);

export const judgeInviteStatusEnum = pgEnum("judge_invite_status", [
  INVITE_STATUS.PENDING,
  INVITE_STATUS.ACCEPTED,
  INVITE_STATUS.DECLINED,
]);

export const customQuestionTypeEnum = pgEnum("custom_question_type", [
  CUSTOM_QUESTION_TYPE.TEXT,
  CUSTOM_QUESTION_TYPE.LONG_TEXT,
  CUSTOM_QUESTION_TYPE.URL,
  CUSTOM_QUESTION_TYPE.NUMBER,
  CUSTOM_QUESTION_TYPE.SINGLE_SELECT,
  CUSTOM_QUESTION_TYPE.MULTI_SELECT,
]);

export const submissionStatusEnum = pgEnum("submission_status", [
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.SUBMITTED,
]);

export const judgeAssignmentStatusEnum = pgEnum("judge_assignment_status", [
  JUDGE_ASSIGNMENT_STATUS.ASSIGNED,
  JUDGE_ASSIGNMENT_STATUS.IN_PROGRESS,
  JUDGE_ASSIGNMENT_STATUS.COMPLETED,
]);

export const draftSubmittedStatusEnum = pgEnum("draft_submitted_status", [
  SUBMISSION_STATUS.DRAFT,
  SUBMISSION_STATUS.SUBMITTED,
]);

export const normalizationMethodEnum = pgEnum("normalization_method", [
  NORMALIZATION_METHOD.Z_SCORE,
  NORMALIZATION_METHOD.MIN_MAX,
]);

export const pairwiseWinnerEnum = pgEnum("pairwise_winner", [
  PAIRWISE_WINNER.A,
  PAIRWISE_WINNER.B,
  PAIRWISE_WINNER.TIE,
]);

export const certificateTypeEnum = pgEnum("certificate_type", [
  CERTIFICATE_TYPE.PARTICIPATION,
  CERTIFICATE_TYPE.WINNER,
  CERTIFICATE_TYPE.JUDGE,
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  WEBHOOK_DELIVERY_STATUS.PENDING,
  WEBHOOK_DELIVERY_STATUS.SUCCEEDED,
  WEBHOOK_DELIVERY_STATUS.FAILED,
]);
