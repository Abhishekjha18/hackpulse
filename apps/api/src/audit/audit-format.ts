// FR-ABUSE-05's log stores machine-shaped rows (dot-separated action codes,
// bare actor/resource ids) by design — that's what the hash chain covers.
// Turning that into something a human can actually read without cross-
// referencing ids by hand is a read-side concern, kept here as pure
// functions so it's testable without a database.
import { AUDIT_ACTION } from "@hackpulse/shared";

export interface AuditLogRow {
  id: string;
  eventId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface DescribedAuditEntry extends AuditLogRow {
  actorName: string;
  actionLabel: string;
  resourceLabel: string;
}

export interface NameLookups {
  userNames: Map<string, string>;
  submissionNames: Map<string, string>;
  trackNames: Map<string, string>;
}

// One label per action string that AuditService.log() is ever called with —
// see the grep-verified inventory in this plan's design notes. An action
// missing here still renders (describeAuditEntry falls back to the raw
// string), so a new call site never breaks the UI, it just reads as raw
// until a label is added here.
export const ACTION_LABELS: Record<string, string> = {
  [AUDIT_ACTION.AUTH_SIGN_IN]: "Signed in",
  [AUDIT_ACTION.AUTH_SIGN_UP]: "Signed up",
  [AUDIT_ACTION.AUTH_SIGN_OUT]: "Signed out",
  [AUDIT_ACTION.EVENT_ROLE_GRANTED]: "Joined a role",
  [AUDIT_ACTION.EVENT_ROLE_REVOKED]: "Removed from a role",
  [AUDIT_ACTION.USER_ORGANIZER_STATUS_CHANGED]: "Changed organizer access",
  [AUDIT_ACTION.SCORE_WINDOW_REJECTED]: "Blocked — judging window closed",
  [AUDIT_ACTION.SCORE_EDIT]: "Edited a submitted score",
  [AUDIT_ACTION.SCORE_SUBMIT]: "Submitted a score",
  [AUDIT_ACTION.SCORE_ACCESS_DENIED]: "Blocked — tried to view another judge's score",
  [AUDIT_ACTION.RESULTS_PUBLISH]: "Published results",
  [AUDIT_ACTION.EXPORT_ARCHIVE]: "Exported the full event archive",
  [AUDIT_ACTION.EXPORT_CSV]: "Exported data",
  [AUDIT_ACTION.IMPORT_CSV]: "Imported data",
  [AUDIT_ACTION.SUBMISSION_DEADLINE_REJECTED]: "Blocked — submission deadline",
  [AUDIT_ACTION.TRACK_SCOPE_ACCESS_DENIED]: "Blocked — tried to judge outside assigned track",
  [AUDIT_ACTION.AUDIT_LOG_ACCESS_DENIED]: "Blocked — tried to view the audit log",
  [AUDIT_ACTION.VOTE_CAST]: "Cast a vote",
};

function meta(row: AuditLogRow): Record<string, unknown> {
  return row.metadata !== null && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nameOrFallback(
  id: string | undefined,
  names: Map<string, string>,
  fallback: string,
): string {
  if (!id) {
    return fallback;
  }
  return names.get(id) ?? fallback;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export function resourceLabelFor(row: AuditLogRow, lookups: NameLookups): string {
  const m = meta(row);
  switch (row.action) {
    case "event_role.granted": {
      const role = str(m.role) ?? "role";
      return m.self === true ? `${capitalize(role)} (self-judged)` : capitalize(role);
    }
    case "event_role.revoked": {
      const role = str(m.role) ?? "role";
      const targetName = nameOrFallback(str(m.targetUserId), lookups.userNames, "Unknown user");
      return `${targetName} — ${role}`;
    }
    case "user.organizer_status_changed":
      return nameOrFallback(row.resourceId, lookups.userNames, "Unknown user");
    case "score.edit":
    case "score.submit":
    case "score.access_denied": {
      const submissionId = str(m.submissionId);
      const name = submissionId ? lookups.submissionNames.get(submissionId) : undefined;
      return name ? `"${name}"` : "a submission";
    }
    case "score.window_rejected": {
      const attempted = str(m.attemptedAction) ?? "act";
      return `attempted to ${attempted}`;
    }
    case "export.csv":
    case "import.csv": {
      const resource = str(m.resource) ?? "event data";
      const format = str(m.format) ?? "csv";
      return `${resource} (${format})`;
    }
    case "export.archive":
      return "full event archive";
    case "results.publish":
      return "results";
    case "submission.deadline_rejected": {
      if (row.resourceType === "submission") {
        return nameOrFallback(row.resourceId, lookups.submissionNames, "a submission");
      }
      const attempted = str(m.attemptedAction) ?? "submit";
      return `attempted to ${attempted} a new submission`;
    }
    case "track_scope.access_denied":
      return nameOrFallback(row.resourceId, lookups.trackNames, "a track");
    case "audit_log.access_denied":
      return row.eventId ? "this event's audit log" : "the instance-wide audit log";
    case "auth.sign_in":
    case "auth.sign_up":
    case "auth.sign_out":
      return nameOrFallback(row.resourceId, lookups.userNames, "an account");
    case "vote.cast":
      return "a vote";
    default:
      return `${row.resourceType} ${row.resourceId.slice(0, 8)}`;
  }
}

export function describeAuditEntry(row: AuditLogRow, lookups: NameLookups): DescribedAuditEntry {
  const actorName = row.actorUserId
    ? (lookups.userNames.get(row.actorUserId) ?? "Unknown user")
    : "Anonymous";
  return {
    ...row,
    actorName,
    actionLabel: ACTION_LABELS[row.action] ?? row.action,
    resourceLabel: resourceLabelFor(row, lookups),
  };
}
