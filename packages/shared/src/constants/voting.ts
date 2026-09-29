// Event configuration values for how an event is scored and voted on. Keys
// are alphabetical in every object.
export const GALLERY_VISIBILITY = {
  HIDDEN: "hidden",
  OPEN: "open",
  PARTICIPANTS_ONLY: "participants_only",
} as const;

export const SCORING_MODE = {
  PAIRWISE: "pairwise",
  RUBRIC: "rubric",
} as const;

export const VOTING_ACCESS = {
  AUTHENTICATED: "authenticated",
  EMAIL_GATED: "email_gated",
  OPEN_LINK: "open_link",
} as const;

export const VOTING_MODE = {
  DISABLED: "disabled",
  QUADRATIC: "quadratic",
  SINGLE_VOTE: "single_vote",
} as const;
