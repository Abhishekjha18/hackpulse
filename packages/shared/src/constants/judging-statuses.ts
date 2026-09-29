// Status values for the judging pipeline. Keys are alphabetical in every
// object.
export const JUDGE_ASSIGNMENT_STATUS = {
  ASSIGNED: "assigned",
  COMPLETED: "completed",
  IN_PROGRESS: "in_progress",
} as const;

export const SCORE_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;

export const SUBMISSION_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
} as const;
