"use client";

import type { EventStatus } from "@hackpulse/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { LoadingState, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";

interface SearchResults {
  events: { id: string; name: string; status: EventStatus; displayStatus: EventStatus }[];
  eventsHasMore: boolean;
  submissions: { id: string; name: string; tagline: string; eventId: string; eventName: string }[];
  submissionsHasMore: boolean;
  users: { id: string; name: string }[];
  usersHasMore: boolean;
}

// A full-page counterpart to the nav dropdown's quick-find — what Enter
// in that box lands on. Found live: it used to hard-redirect to
// /events?search=..., which is an events-only page, so pressing Enter on
// a query that only matched a person or a project (or nothing at all)
// made the whole app look events-only even though the dropdown itself
// already searches across all three. This page asks with a higher limit
// (20, vs. the dropdown's 5) so "more match" in the dropdown actually
// leads somewhere with more of them, not just a bigger version of the
// same cap.
const PAGE_LIMIT = 20;

export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      api
        .get<SearchResults>(`/search?q=${encodeURIComponent(trimmed)}&limit=${PAGE_LIMIT}`)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((e) => setError(e.message));
    }, 250);
  }, [query]);

  const trimmed = query.trim();
  const hasResults =
    results &&
    (results.events.length > 0 || results.submissions.length > 0 || results.users.length > 0);

  return (
    <div>
      <h1 className="text-h1 font-semibold text-ink">Search</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Covers every event, project, and person on this instance, not just events.
      </p>

      <input
        autoFocus
        type="search"
        placeholder="Search events, projects, people…"
        data-testid="search-page-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-6 w-full max-w-md rounded-md border border-line px-3 py-2 text-sm"
      />

      {trimmed.length > 0 && trimmed.length < 2 && (
        <p className="mt-4 text-sm text-muted">Keep typing until you have at least 2 characters.</p>
      )}

      {error && <p className="mt-6 text-sm text-danger">{error}</p>}

      {trimmed.length >= 2 && results === null && !error && <LoadingState className="mt-6" />}

      {trimmed.length >= 2 && results !== null && !hasResults && (
        <p className="mt-6 text-sm leading-relaxed text-muted" data-testid="search-page-empty">
          No events, projects, or people matched &ldquo;{trimmed}&rdquo;.
        </p>
      )}

      {results && hasResults && (
        <div className="mt-8 space-y-8" data-testid="search-page-results">
          {results.events.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Events
                {results.eventsHasMore
                  ? ` (showing first ${results.events.length}, refine your search for the rest)`
                  : ""}
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {results.events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/events/${e.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-alt"
                    >
                      <span className="text-sm font-medium text-ink">{e.name}</span>
                      <StatusBadge status={e.displayStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.submissions.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Projects
                {results.submissionsHasMore
                  ? ` (showing first ${results.submissions.length}, refine your search for the rest)`
                  : ""}
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {results.submissions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/submissions/${s.id}`}
                      className="block px-4 py-3 hover:bg-surface-alt"
                    >
                      <p className="text-sm font-medium text-ink">
                        {s.name} <span className="font-normal text-muted">in {s.eventName}</span>
                      </p>
                      {s.tagline && <p className="mt-0.5 text-xs text-muted">{s.tagline}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.users.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                People
                {results.usersHasMore
                  ? ` (showing first ${results.users.length}, refine your search for the rest)`
                  : ""}
              </h2>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {results.users.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/users/${u.id}`}
                      className="block px-4 py-3 text-sm font-medium text-ink hover:bg-surface-alt"
                    >
                      {u.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
