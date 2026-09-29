"use client";

import type { Event, Prize, Submission, Track } from "@hackpulse/shared";
import { EVENT_ROLE, EVENT_STATUS, VOTING_MODE } from "@hackpulse/shared/constants";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  CountdownChip,
  EventBannerOrDefault,
  LoadingState,
  StatusBadge,
  ThumbnailOrInitials,
  VoteBadge,
} from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import {
  computePlacements,
  computeWonPrizes,
  type Placement,
  type ResultsResponse,
} from "../../../lib/results";
interface VoteTallyRow {
  submissionId: string;
  totalVotes: number;
  voterCount: number;
}

export default function EventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [wonPrizes, setWonPrizes] = useState<string[]>([]);
  const searchDebounceRef = useRef<number | null>(null);

  const loadGallery = (opts: { search: string; track: string; tag: string }) => {
    const params = new URLSearchParams();
    if (opts.search) {
      params.set("search", opts.search);
    }
    if (opts.track) {
      params.set("track", opts.track);
    }
    if (opts.tag) {
      params.set("tag", opts.tag);
    }
    const qs = params.toString();
    api
      .get<{ items: Submission[] }>(`/events/${eventId}/gallery${qs ? `?${qs}` : ""}`)
      .then((r) => {
        setSubmissions(r.items);
        // Only widen the known tag set, never shrink it when a filter narrows
        // the visible results, or picking a tag would make every other tag
        // option disappear from the dropdown.
        setAllTags((prev) => [...new Set([...prev, ...r.items.flatMap((s) => s.techTags)])].sort());
      })
      .catch(() => {
        /* gallery may be private — the event detail error, if any, already covers it */
      });
  };

  useEffect(() => {
    api
      .get<Event>(`/events/${eventId}`)
      .then((e) => {
        setEvent(e);
        // Vote tallies stay hidden from the public until results are
        // published (FR-RESULT-02): only ask once we know that's true,
        // rather than relying on the API's 403 to hide the UI reactively.
        if (e.status === EVENT_STATUS.RESULTS_PUBLISHED) {
          api
            .get<VoteTallyRow[]>(`/events/${eventId}/votes/tally`)
            .then((rows) =>
              setTally(Object.fromEntries(rows.map((r) => [r.submissionId, r.totalVotes]))),
            )
            .catch(() => {});
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load event"));
    loadGallery({ search: "", track: "", tag: "" });
    api
      .get<Prize[]>(`/events/${eventId}/prizes`)
      .then(setPrizes)
      .catch(() => {});
    api
      .get<Track[]>(`/events/${eventId}/tracks`)
      .then(setTracks)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Search is debounced (network round-trip per keystroke would be
  // wasteful); the track/tag filters re-fetch immediately since they're
  // discrete choices, not free text.
  useEffect(() => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      loadGallery({ search, track: trackFilter, tag: tagFilter });
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, trackFilter, tagFilter]);

  // Requested explicitly, on both counts: (1) every participant should see
  // their placement once results publish, not just whoever came first --
  // "won" used to be derived purely as rank 1 in a result set, so ranks 2+
  // got nothing at all; (2) a prize win is a separate fact, driven by each
  // prize's own winnerCount (top N within its track, or overall if
  // trackId is null) matched against `prizes` (already loaded above), not
  // hardcoded to "rank 1 wins." A separate effect keyed on
  // [eventId, event, user, prizes]: the auth session resolves async, often
  // after the event fetch, so folding this into that effect would silently
  // skip it whenever user was still null on the first run.
  useEffect(() => {
    if (!user || !event || event.status !== EVENT_STATUS.RESULTS_PUBLISHED) {
      setPlacements([]);
      setWonPrizes([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      api.get<Submission[]>(`/events/${eventId}/submissions/mine`).catch(() => []),
      api.get<ResultsResponse>(`/events/${eventId}/results`).catch(() => null),
    ]).then(([mine, results]) => {
      if (cancelled || !results || mine.length === 0) {
        return;
      }
      const mineIds = new Set(mine.map((s) => s.id));
      const myPlacements = computePlacements(mineIds, results);
      setPlacements(myPlacements);
      setWonPrizes(computeWonPrizes(myPlacements, prizes).map((prize) => prize.name));
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, event, user, prizes]);

  // Found live: a self-judging organizer holds *two* eventRoles rows for
  // this event (organizer and judge), but `.find()` only ever returns the
  // first one, so one of their two dashboard links silently disappeared
  // depending on row order. Checked independently instead — both buttons
  // show whenever both roles apply.
  // isAdmin doesn't satisfy either check: an admin only gets the organizer
  // dashboard link for events they actually organize, same as anyone else.
  // See apps/api/src/common/auth/is-event-organizer.ts.
  const myEventRoles = user?.eventRoles.filter((r) => r.eventId === eventId) ?? [];
  const isOrganizer = myEventRoles.some((r) => r.role === EVENT_ROLE.ORGANIZER);
  const isJudge = myEventRoles.some((r) => r.role === EVENT_ROLE.JUDGE);

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!event) {
    return <LoadingState />;
  }

  return (
    <div>
      <EventBannerOrDefault
        bannerImageUrl={event.bannerImageUrl}
        name={event.name}
        className="mb-6 h-48 rounded-xl border border-line sm:h-64"
      />
      {wonPrizes.length > 0 && (
        <div
          data-testid="win-banner"
          className="mb-6 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm leading-relaxed text-ink"
        >
          Congratulations! Your team won <strong>{wonPrizes.join(", ")}</strong>.
        </div>
      )}
      {placements.length > 0 && (
        <div
          data-testid="placement-banner"
          className="mb-6 rounded-lg border border-line bg-surface-alt px-4 py-3 text-sm leading-relaxed text-ink"
        >
          Your placement:{" "}
          {placements.map((p, i) => (
            <span key={p.label}>
              {i > 0 && ", "}
              <strong>
                #{p.rank} of {p.total}
              </strong>{" "}
              in {p.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={event.displayStatus} />
            {event.displayStatus === EVENT_STATUS.SUBMISSIONS_OPEN && event.submissionCloseAt && (
              <CountdownChip deadline={event.submissionCloseAt} />
            )}
          </div>
          <h1 className="mt-2 text-h1 font-semibold text-ink">{event.name}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{event.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {event.votingMode !== VOTING_MODE.DISABLED && (
            <Link
              href={`/events/${eventId}/vote`}
              className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
            >
              Vote
            </Link>
          )}
          <Link
            href={`/events/${eventId}/results`}
            className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
          >
            Results
          </Link>
          {user && !isOrganizer && !isJudge && (
            <>
              <Link
                href={`/events/${eventId}/team`}
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
              >
                My team
              </Link>
              <Link
                href={`/events/${eventId}/submit`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
              >
                Submit a project
              </Link>
            </>
          )}
          {isJudge && (
            <Link
              href={`/events/${eventId}/judge`}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Judging queue
            </Link>
          )}
          {isOrganizer && (
            <Link
              href={`/events/${eventId}/organizer`}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Organizer dashboard
            </Link>
          )}
          {user?.isAdmin && !isOrganizer && (
            <Link
              href={`/admin/audit-log?eventId=${eventId}`}
              className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
            >
              Audit log (admin)
            </Link>
          )}
        </div>
      </div>

      {prizes.length > 0 && (
        <div className="mt-8">
          <h2 className="text-h2 font-semibold text-ink">Prizes</h2>
          {/* Every prize shows which track it's for (or "Overall") plus its
              description, so a track-scoped prize doesn't look identical
              to an event-wide one. Found live: winnerCount (how many teams
              actually win this prize, e.g. top 3 in a track) was only ever
              shown on the organizer dashboard's edit form -- participants
              had no way to know whether a prize had one winner or several. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {prizes.map((p) => {
              const track = p.trackId ? tracks.find((t) => t.id === p.trackId) : null;
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-line bg-surface-alt px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {track ? track.name : "Overall"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-muted">
                    {p.winnerCount} winner{p.winnerCount !== 1 ? "s" : ""}
                  </p>
                  {p.description && (
                    <p className="mt-1 text-sm leading-relaxed text-muted">{p.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="mt-8 text-h2 font-semibold text-ink">Gallery</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="Search projects…"
          data-testid="gallery-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
        />
        {tracks.length > 0 && (
          <select
            data-testid="gallery-track-filter"
            value={trackFilter}
            onChange={(e) => setTrackFilter(e.target.value)}
            className="rounded-md border border-line px-3 py-2 text-sm"
          >
            <option value="">All tracks</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {allTags.length > 0 && (
          <select
            data-testid="gallery-tag-filter"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-line px-3 py-2 text-sm"
          >
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>
      {submissions.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          {search || trackFilter || tagFilter ? "No projects match." : "No public submissions yet."}
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {submissions.map((s) => (
            <div
              key={s.id}
              className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
            >
              <Link href={`/submissions/${s.id}`} className="block h-28 w-full shrink-0">
                <ThumbnailOrInitials thumbnailUrl={s.thumbnailUrl} name={s.name} />
              </Link>
              {/* flex-col + flex-1 on this wrapper and mt-auto on the footer
                  keep "Details & comments" aligned across every card in a
                  row, regardless of how many lines the tagline wraps to —
                  without it, a 2-line tagline on one card and a 1-line
                  tagline on its neighbor push the footer link to two
                  different heights. */}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/submissions/${s.id}`}>
                    <h3 className="text-h3 font-semibold text-ink hover:text-accent">{s.name}</h3>
                  </Link>
                  {tally[s.id] !== undefined && <VoteBadge count={tally[s.id]} />}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.tagline}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.techTags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex gap-3 pt-3">
                  <Link
                    href={`/submissions/${s.id}`}
                    className="text-sm text-accent hover:underline"
                  >
                    Details & comments →
                  </Link>
                  {s.liveUrl && (
                    <a
                      href={s.liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-muted hover:underline"
                    >
                      Live demo
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
