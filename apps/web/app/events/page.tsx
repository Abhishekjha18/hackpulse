"use client";

import type { Event } from "@hackpulse/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import {
  CountdownChip,
  EventBannerOrDefault,
  LoadingState,
  PrizeChip,
  StatusBadge,
} from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

interface EventListItem extends Event {
  submissionCount: number;
  prizeNames: string[];
  createdAt: string;
}

const NEW_WINDOW_MS = 48 * 60 * 60 * 1000;

// useSearchParams() opts the whole subtree into client-side rendering and
// needs a Suspense boundary around it per Next's own requirement — kept
// as a thin wrapper so the rest of the page doesn't have to think about it.
export default function EventsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <EventsPageInner />
    </Suspense>
  );
}

function EventsPageInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"active" | "past" | "mine">("active");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [events, setEvents] = useState<EventListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    // "Mine" isn't meaningful while signed out — fall back to Active
    // rather than showing an empty list with no explanation.
    if (phase === "mine" && !user) {
      setPhase("active");
      return;
    }
    setEvents(null);
    setError(null);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      const params = new URLSearchParams({ phase });
      if (search) {
        params.set("search", search);
      }
      api
        .get<{ items: EventListItem[]; nextCursor: string | null }>(`/events?${params.toString()}`)
        .then((r) => setEvents(r.items))
        .catch((e) => setError(e.message));
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, search, user]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-h1 font-semibold text-ink">Events</h1>
        {user && (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/events/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Create event
            </Link>
            <label className="cursor-pointer rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt">
              {importing ? "Importing…" : "Import from archive…"}
              <input
                type="file"
                accept="application/json"
                data-testid="import-archive-input"
                className="hidden"
                disabled={importing}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) {
                    return;
                  }
                  setImportError(null);
                  setImporting(true);
                  try {
                    const text = await file.text();
                    const parsed = JSON.parse(text);
                    const result = await api.post<{
                      event: { id: string; name: string };
                      warnings: string[];
                    }>("/import/archive", parsed);
                    if (result.warnings.length > 0) {
                      window.alert(
                        `Imported "${result.event.name}" with some warnings:\n\n${result.warnings.join("\n")}`,
                      );
                    }
                    router.push(`/events/${result.event.id}/organizer`);
                  } catch (err) {
                    setImportError(
                      err instanceof ApiError ? err.message : "Failed to import archive",
                    );
                    setImporting(false);
                  }
                }}
              />
            </label>
          </div>
        )}
      </div>
      {importError && <p className="mt-2 text-sm text-danger">{importError}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-line" data-testid="event-phase-tabs">
          {(user ? (["active", "past", "mine"] as const) : (["active", "past"] as const)).map(
            (p) => (
              <button
                key={p}
                type="button"
                data-testid={`event-phase-${p}`}
                onClick={() => setPhase(p)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize ${
                  phase === p
                    ? "border-accent text-accent-dark"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {p === "mine" ? "My events" : p}
              </button>
            ),
          )}
        </div>
        <input
          type="search"
          placeholder="Search events…"
          data-testid="event-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-md border border-line px-3 py-1.5 text-sm"
        />
      </div>

      {error && <p className="mt-6 text-sm text-danger">{error}</p>}

      {events === null && !error && <LoadingState className="mt-6" />}

      {events?.length === 0 && (
        <p className="mt-6 text-sm leading-relaxed text-muted">
          {search
            ? "No events match your search."
            : phase === "active"
              ? "No active events right now."
              : phase === "mine"
                ? "You're not on any events yet."
                : "No past events yet."}
        </p>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {events?.map((event) => {
          const isNew = Date.now() - new Date(event.createdAt).getTime() < NEW_WINDOW_MS;
          return (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="group relative overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
            >
              <EventBannerOrDefault
                bannerImageUrl={event.bannerImageUrl}
                name={event.name}
                className="h-28 border-b border-line"
              />
              <div className="p-4">
                <span className="absolute inset-y-0 left-0 w-1 bg-pulse opacity-0 transition group-hover:opacity-100" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={event.displayStatus} />
                    {isNew && (
                      <span
                        data-testid="event-new-badge"
                        className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent-dark"
                      >
                        New
                      </span>
                    )}
                  </div>
                  {event.displayStatus === "submissions_open" && event.submissionCloseAt && (
                    <CountdownChip deadline={event.submissionCloseAt} />
                  )}
                </div>
                <h2 className="mt-3 text-h2 font-semibold text-ink">{event.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                  {event.description}
                </p>
                {(event.submissionCount > 0 || event.prizeNames.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {event.submissionCount > 0 && (
                      <span className="text-xs text-muted">
                        {event.submissionCount} submission{event.submissionCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {event.prizeNames.map((name) => (
                      <PrizeChip key={name} name={name} />
                    ))}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
