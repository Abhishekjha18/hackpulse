// How an event's status is driven: from configured dates ("automatic") or by
// the organizer moving it by hand ("manual"). Keys are alphabetical.
export const LIFECYCLE_MODE = {
  AUTOMATIC: "automatic",
  MANUAL: "manual",
} as const;
