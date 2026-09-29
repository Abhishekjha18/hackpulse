// Action codes written to the append-only audit log (AuditService.log).
// Dot-separated `<area>.<what happened>`. Keys are alphabetical (enforced by
// the sort-keys lint rule for this directory).
export const AUDIT_ACTION = {
  AUDIT_LOG_ACCESS_DENIED: "audit_log.access_denied",
  AUTH_SIGN_IN: "auth.sign_in",
  AUTH_SIGN_OUT: "auth.sign_out",
  AUTH_SIGN_UP: "auth.sign_up",
  EVENT_ROLE_GRANTED: "event_role.granted",
  EVENT_ROLE_REVOKED: "event_role.revoked",
  EXPORT_ARCHIVE: "export.archive",
  EXPORT_CSV: "export.csv",
  IMPORT_CSV: "import.csv",
  RESULTS_PUBLISH: "results.publish",
  SCORE_ACCESS_DENIED: "score.access_denied",
  SCORE_EDIT: "score.edit",
  SCORE_SUBMIT: "score.submit",
  SCORE_WINDOW_REJECTED: "score.window_rejected",
  SUBMISSION_DEADLINE_REJECTED: "submission.deadline_rejected",
  TRACK_SCOPE_ACCESS_DENIED: "track_scope.access_denied",
  USER_ORGANIZER_STATUS_CHANGED: "user.organizer_status_changed",
  VOTE_CAST: "vote.cast",
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
