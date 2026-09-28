"use client";

import type { EventStatus } from "@hackpulse/shared";
import Link from "next/link";
import { useEffect, useState } from "react";

import { LoadingState, StatusBadge } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";

interface MyTeamRow {
  teamId: string;
  teamName: string;
  eventId: string;
  eventName: string;
  eventDisplayStatus: EventStatus;
}

export default function MyTeamsPage() {
  const [rows, setRows] = useState<MyTeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MyTeamRow[]>("/users/me/teams")
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load teams"));
  }, []);

  return (
    <div className="max-w-xl">
      <h1 className="text-h1 font-semibold text-ink">My teams</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Every team you&rsquo;re a member of, across every event.
      </p>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {rows === null && !error && <LoadingState className="mt-4" />}
      {rows?.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          You haven&rsquo;t joined a team yet.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {rows?.map((r) => (
          <Link
            key={r.teamId}
            href={`/events/${r.eventId}/team`}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 hover:border-accent"
          >
            <div>
              <div className="text-sm font-medium text-ink">{r.teamName}</div>
              <div className="text-xs leading-normal text-muted">{r.eventName}</div>
            </div>
            <StatusBadge status={r.eventDisplayStatus} />
          </Link>
        ))}
      </div>
    </div>
  );
}
