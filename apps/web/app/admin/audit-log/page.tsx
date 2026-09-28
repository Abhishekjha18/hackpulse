"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { LoadingState } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  actionLabel: string;
  resourceType: string;
  resourceId: string;
  resourceLabel: string;
  createdAt: string;
}

interface VerifyResult {
  valid: boolean;
  brokenAt?: string;
  reason?: string;
  entriesChecked?: number;
}

// REQUIREMENTS.md's Admin role is defined with "full audit access" — this
// is that surface. It reads whichever partition the backend's own
// isAdmin bypass already allows (AuditController/AuditGlobalController):
// a specific event's log via ?eventId=, or the instance-wide GLOBAL
// partition with no query param. There's no organizer-dashboard route
// into this: an admin who doesn't organize the event is deliberately
// blocked from that whole page (see its own isOrganizer gate), so this
// is the only UI path to the per-event bypass the backend already grants.
export default function AdminAuditLogPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminAuditLogPageInner />
    </Suspense>
  );
}

function AdminAuditLogPageInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.isAdmin) {
      return;
    }
    const base = eventId ? `/events/${eventId}/audit-log` : "/audit-log/global";
    setError(null);
    setLoaded(false);
    api
      .get<{ items: AuditEntry[] }>(base)
      .then((r) => setEntries(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load the audit log"))
      .finally(() => setLoaded(true));
    api
      .get<VerifyResult>(`${base}/verify`)
      .then(setVerify)
      .catch(() => setVerify(null));
  }, [user?.isAdmin, eventId]);

  if (authLoading) {
    return <LoadingState />;
  }
  if (!user?.isAdmin) {
    return (
      <div className="max-w-md">
        <h1 className="text-h1 font-semibold text-ink">Audit log</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Only an instance admin can view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-h1 font-semibold text-ink">
        {eventId ? "Event audit log" : "Instance-wide audit log"}
      </h1>
      <p className="mt-1 text-xs leading-normal text-muted">
        {eventId
          ? "This event's own append-only log, read via admin oversight access."
          : "Site-wide actions with no single event of their own (auth, admin capability grants)."}
      </p>

      {error && (
        <p data-testid="admin-audit-error" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {verify && (
        <p
          data-testid="admin-audit-verify-status"
          className={`mt-3 text-xs ${verify.valid ? "text-success" : "text-danger"}`}
        >
          {verify.valid
            ? "Chain verified. No tampering detected."
            : `Chain broken at entry ${verify.brokenAt} (${verify.reason}).`}
        </p>
      )}

      {!loaded ? (
        <LoadingState className="mt-6" />
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">No audit entries yet.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-1">When</th>
              <th className="pb-1">Action</th>
              <th className="pb-1">Resource</th>
              <th className="pb-1">Actor</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line">
                <td className="py-1 text-xs text-muted">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="py-1">{entry.actionLabel}</td>
                <td className="py-1 text-xs text-muted">{entry.resourceLabel}</td>
                <td className="py-1 text-xs text-muted">{entry.actorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
