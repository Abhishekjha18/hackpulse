"use client";

import type { Event, Prize, Submission } from "@hackpulse/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  computePlacements,
  computeWonPrizes,
  type Placement,
  type ResultsResponse,
} from "../lib/results";

interface QueueEntry {
  assignment: { id: string; status: string };
}
interface PairwiseProgressEntry {
  trackId: string;
  trackName: string;
  remaining: number;
  totalPairs: number;
}

interface PendingItem {
  kind: "judging";
  eventId: string;
  eventName: string;
  count: number;
}
// Requested explicitly: every participant should hear their rank, whether
// or not they won anything, not just the one team that happened to place
// first. Separate from WinItem below by design -- a placement is always
// true once results publish, a prize win is a distinct, rarer fact about
// the same result.
interface RankItem {
  kind: "rank";
  eventId: string;
  eventName: string;
  placements: Placement[];
}
// Requested explicitly: winning an actual configured prize (rank <= that
// prize's winnerCount, within its track or overall) is worth a separate,
// more specific notification than the general rank one above.
interface WinItem {
  kind: "win";
  eventId: string;
  eventName: string;
  prizeNames: string[];
}
type NotificationItem = PendingItem | RankItem | WinItem;

// Requested explicitly, then refined after a follow-up correction: only
// rank/win announcements (a one-time fact about a published result, with
// nothing further to do about it) stop reappearing once someone has
// actually seen them. A judging reminder stays visible until actually
// acted upon -- a reminder that a judge still has pending work isn't
// "read and done" just because the bell was opened. A judging item
// disappears on its own once its underlying count reaches 0 (no items
// left to judge). There's no notifications table -- every item here is
// recomputed live from other tables each load(), not a stored discrete
// event -- so "read" state for win/rank is tracked client-side by a
// stable per-item key (just the eventId, since a result is immutable once
// published), scoped per signed-in user (multiple accounts often share a
// browser in this dev environment).
function notificationKey(item: NotificationItem): string | null {
  if (item.kind === "win") {
    return `win:${item.eventId}`;
  }
  if (item.kind === "rank") {
    return `rank:${item.eventId}`;
  }
  return null;
}
function loadReadKeys(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`hackpulse:notifications-read:${userId}`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}
function saveReadKeys(userId: string, keys: Set<string>) {
  try {
    localStorage.setItem(`hackpulse:notifications-read:${userId}`, JSON.stringify([...keys]));
  } catch {
    // Best-effort -- private browsing / blocked storage just means read
    // state doesn't persist across reloads, not a functional failure.
  }
}

// Consolidates "pending judging" and "you won" into one place reachable
// from every page, instead of each living as a page-specific banner a
// user only sees by being on the right page.
export function NotificationsBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());
  const wasOpen = useRef(false);

  // Re-fetches on an interval and whenever the dropdown opens, rather than
  // just once on mount, so the count doesn't go stale after an action
  // elsewhere (scoring, results publishing) changes it.
  useEffect(() => {
    if (!user) {
      return;
    }
    const id = setInterval(() => setRefreshKey((k) => k + 1), 30_000);
    return () => clearInterval(id);
  }, [user]);

  useEffect(() => {
    if (open) {
      setRefreshKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setReadKeys(user ? loadReadKeys(user.id) : new Set());
  }, [user]);

  // Marks everything that was visible during this viewing as read once the
  // dropdown closes again -- not the instant it opens, so items don't
  // visibly vanish out from under someone still reading them. Guarded by
  // wasOpen so this doesn't fire on the initial mount (open starts false,
  // which is not a close).
  useEffect(() => {
    if (wasOpen.current && !open && user) {
      const newlyRead = items.map(notificationKey).filter((k): k is string => k !== null);
      if (newlyRead.length > 0) {
        setReadKeys((prev) => {
          const next = new Set(prev);
          for (const key of newlyRead) {
            next.add(key);
          }
          saveReadKeys(user.id, next);
          return next;
        });
      }
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    let cancelled = false;

    async function load() {
      const judgeEventIds = user!.eventRoles
        .filter((r) => r.role === "judge")
        .map((r) => r.eventId);
      // Found live ("did not receive any notification on judging the
      // submission"): this only ever checked the rubric-mode assignment
      // queue, which pairwise mode never populates -- no assignment
      // concept exists there, only track scope -- so a pairwise judge got
      // this reminder never, regardless of how much work was actually
      // waiting. Branches on scoringMode now; pairwise uses
      // PairwiseService.getProgressForJudge's per-track "pairs not yet
      // compared even once" count instead of assignment completion.
      const pendingPromise = Promise.all(
        judgeEventIds.map(async (eventId) => {
          const event = await api.get<Event>(`/events/${eventId}`).catch(() => null);
          if (!event) {
            return null;
          }
          const count =
            event.scoringMode === "pairwise"
              ? await api
                  .get<PairwiseProgressEntry[]>(`/events/${eventId}/pairwise/progress`)
                  .then((rows) => rows.reduce((sum, r) => sum + r.remaining, 0))
                  .catch(() => 0)
              : await api
                  .get<QueueEntry[]>(`/events/${eventId}/judging/queue`)
                  .then((queue) => queue.filter((q) => q.assignment.status !== "completed").length)
                  .catch(() => 0);
          return count > 0
            ? ({ kind: "judging", eventId, eventName: event.name, count } as PendingItem)
            : null;
        }),
      );

      const minePromise = api
        .get<{ items: Event[] }>("/events?phase=mine&limit=100")
        .then((r) => r.items.filter((e) => e.status === "results_published"))
        .catch(() => [] as Event[]);

      const [pendingResults, publishedMine] = await Promise.all([pendingPromise, minePromise]);

      // Requested explicitly, on both counts: (1) every participant should
      // hear their rank once results publish, not just whoever came first
      // -- previously only rank === 1 produced anything at all; (2) a
      // prize win is a separate fact from a placement, driven by each
      // prize's own winnerCount (top N within its track, or overall if
      // trackId is null), not hardcoded to "rank 1 wins."
      const placementResults = await Promise.all(
        publishedMine.map(async (event) => {
          const [mine, results, prizes] = await Promise.all([
            api.get<Submission[]>(`/events/${event.id}/submissions/mine`).catch(() => []),
            api.get<ResultsResponse>(`/events/${event.id}/results`).catch(() => null),
            api.get<Prize[]>(`/events/${event.id}/prizes`).catch(() => [] as Prize[]),
          ]);
          if (mine.length === 0 || !results) {
            return { rankItem: null, winItem: null };
          }
          const mineIds = new Set(mine.map((s) => s.id));
          const placements = computePlacements(mineIds, results);
          const wonPrizeNames = computeWonPrizes(placements, prizes).map((prize) => prize.name);

          return {
            rankItem:
              placements.length > 0
                ? ({
                    kind: "rank",
                    eventId: event.id,
                    eventName: event.name,
                    placements,
                  } as RankItem)
                : null,
            winItem:
              wonPrizeNames.length > 0
                ? ({
                    kind: "win",
                    eventId: event.id,
                    eventName: event.name,
                    prizeNames: wonPrizeNames,
                  } as WinItem)
                : null,
          };
        }),
      );

      if (!cancelled) {
        setItems([
          ...pendingResults.filter((r): r is PendingItem => r !== null),
          ...placementResults.map((r) => r.winItem).filter((r): r is WinItem => r !== null),
          ...placementResults.map((r) => r.rankItem).filter((r): r is RankItem => r !== null),
        ]);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // refreshKey is a re-fetch trigger, not part of the query itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshKey]);

  if (!user) {
    return null;
  }

  // What's actually shown/counted -- items already read on a previous
  // viewing stay hidden even though `items` (and the "mark read on close"
  // effect above) still carries the full, unfiltered set.
  const visibleItems = items.filter((item) => {
    const key = notificationKey(item);
    return !key || !readKeys.has(key);
  });

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="notifications-bell"
        aria-label="Notifications"
        className="relative rounded-md p-1.5 text-muted hover:bg-surface-alt hover:text-ink"
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
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
          />
          <path strokeLinecap="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {visibleItems.length > 0 && (
          <span
            data-testid="notifications-count"
            className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-pulse font-mono text-[10px] font-semibold text-white"
          >
            {visibleItems.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            data-testid="notifications-dropdown"
            className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-line bg-surface p-2 shadow-lg motion-safe:animate-[dropdown-in_150ms_ease-out]"
          >
            {visibleItems.length === 0 ? (
              <p className="p-3 text-xs leading-normal text-muted">Nothing new.</p>
            ) : (
              visibleItems.map((item) => {
                if (item.kind === "judging") {
                  return (
                    <Link
                      key={`judging-${item.eventId}`}
                      href={`/events/${item.eventId}/judge`}
                      onClick={() => setOpen(false)}
                      className="block rounded-md p-2.5 text-sm leading-relaxed hover:bg-surface-alt"
                    >
                      <strong>{item.count}</strong> submission{item.count === 1 ? "" : "s"} waiting
                      for your review in <strong>{item.eventName}</strong>
                    </Link>
                  );
                }
                if (item.kind === "win") {
                  return (
                    <Link
                      key={`win-${item.eventId}`}
                      href={`/events/${item.eventId}`}
                      onClick={() => setOpen(false)}
                      className="block rounded-md p-2.5 text-sm leading-relaxed hover:bg-surface-alt"
                    >
                      You won <strong>{item.prizeNames.join(", ")}</strong> at{" "}
                      <strong>{item.eventName}</strong>
                    </Link>
                  );
                }
                // "rank" -- shown to every participant with a published
                // result, whatever the placement, not just prize winners.
                return (
                  <Link
                    key={`rank-${item.eventId}`}
                    href={`/events/${item.eventId}/results`}
                    onClick={() => setOpen(false)}
                    className="block rounded-md p-2.5 text-sm leading-relaxed hover:bg-surface-alt"
                  >
                    Results are in for <strong>{item.eventName}</strong>:{" "}
                    {item.placements
                      .map((p) => `#${p.rank} of ${p.total} in ${p.label}`)
                      .join(", ")}
                  </Link>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
