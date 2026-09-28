"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { NotificationsBell } from "./notifications-bell";
import { Avatar, ThemeToggle } from "./ui";

interface SearchResults {
  events: { id: string; name: string; status: string }[];
  eventsHasMore: boolean;
  submissions: { id: string; name: string; tagline: string; eventId: string; eventName: string }[];
  submissionsHasMore: boolean;
  users: { id: string; name: string }[];
  usersHasMore: boolean;
}

// Searches across events, projects, and people, not just events: the
// events list page already has its own events-only search box.
function NavSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      api
        .get<SearchResults>(`/search?q=${encodeURIComponent(value.trim())}`)
        .then(setResults)
        .catch(() => setResults(null));
    }, 250);
  }, [value]);

  function go(path: string) {
    setOpen(false);
    setValue("");
    setResults(null);
    router.push(path);
  }

  const hasResults =
    results &&
    (results.events.length > 0 || results.submissions.length > 0 || results.users.length > 0);

  return (
    <div ref={containerRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="nav-search-toggle"
          aria-label="Search"
          className="rounded-md p-1.5 text-muted hover:bg-surface-alt hover:text-ink"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
        </button>
      ) : (
        <input
          autoFocus
          type="search"
          placeholder="Search events, projects, people…"
          data-testid="nav-search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              go(`/search?q=${encodeURIComponent(value.trim())}`);
            }
            if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-64 rounded-md border border-line px-2.5 py-1 text-sm"
        />
      )}

      {open && value.trim().length >= 2 && (
        <div
          data-testid="nav-search-results"
          className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-line bg-surface p-2 shadow-lg motion-safe:animate-[dropdown-in_150ms_ease-out]"
        >
          {!hasResults ? (
            <p className="p-3 text-xs leading-normal text-muted">
              {results ? "No matches." : "Searching…"}
            </p>
          ) : (
            <>
              {results!.events.length > 0 && (
                <div className="mb-1">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Events{results!.eventsHasMore ? " (more match, refine to narrow)" : ""}
                  </p>
                  {results!.events.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => go(`/events/${e.id}`)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-alt"
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
              {results!.submissions.length > 0 && (
                <div className="mb-1">
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Projects{results!.submissionsHasMore ? " (more match, refine to narrow)" : ""}
                  </p>
                  {results!.submissions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => go(`/submissions/${s.id}`)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-alt"
                    >
                      {s.name}
                      <span className="ml-1.5 text-xs text-muted">in {s.eventName}</span>
                    </button>
                  ))}
                </div>
              )}
              {results!.users.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    People{results!.usersHasMore ? " (more match, refine to narrow)" : ""}
                  </p>
                  {results!.users.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => go(`/users/${u.id}`)}
                      className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-alt"
                    >
                      {u.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span className="h-2 w-2 rounded-full bg-pulse" aria-hidden="true" />
          HackPulse
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/events"
            className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
          >
            Events
          </Link>
          <NavSearch />
          {user && <NotificationsBell />}
          <ThemeToggle />
          <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
          {loading ? null : user ? (
            <>
              <Link
                href="/teams/mine"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
              >
                My teams
              </Link>
              <Link
                href="/certificates/mine"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
              >
                Certificates
              </Link>
              {user.isAdmin && (
                <Link
                  href="/admin/audit-log"
                  className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
                >
                  Audit log
                </Link>
              )}
              <Link
                href={`/users/${user.id}`}
                data-testid="nav-profile-link"
                className="ml-1 flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
              >
                <Avatar name={user.name} size={22} />
                {user.name}
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  router.push("/");
                  router.refresh();
                }}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink hover:bg-surface-alt"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="ml-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
