// Event lifecycle statuses, in lifecycle order in the schema enum; keys here
// are alphabetical like every constants file.
export const EVENT_STATUS = {
  ARCHIVED: "archived",
  DRAFT: "draft",
  JUDGING: "judging",
  REGISTRATION_OPEN: "registration_open",
  RESULTS_PUBLISHED: "results_published",
  SUBMISSIONS_OPEN: "submissions_open",
} as const;
