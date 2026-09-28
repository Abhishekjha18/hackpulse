"use client";

import type { Submission, Track } from "@hackpulse/shared";
import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { LoadingState, TagPill, ThumbnailOrInitials } from "./ui";

interface PairwisePair {
  submissionA: Submission;
  submissionB: Submission;
}

// Judge-facing UI for pairwise mode (FR-PAIR): pick a track, compare two
// submissions, then immediately see the next pair, same rhythm as Gavel.
export function PairwiseJudging({ eventId, tracks }: { eventId: string; tracks: Track[] }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const [pair, setPair] = useState<PairwisePair | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Found live ("the judge is stuck in a loop... these comparisons keep
  // repeating"): GET .../pairwise/next used to always return *some* pair
  // even once every pair in the track had already been compared, quietly
  // rotating through all of them forever -- indistinguishable from a real
  // bug to a judge who'd genuinely finished. The backend now returns
  // ALL_PAIRS_COMPARED once that happens; this is a distinct, positive
  // "you're done" state, not an error, so it gets its own flag rather
  // than sharing `error`'s red-text treatment.
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comparedCount, setComparedCount] = useState(0);

  const loadNext = (forTrackId: string) => {
    if (!forTrackId) {
      return;
    }
    setError(null);
    setDone(false);
    setPair(null);
    api
      .get<PairwisePair>(`/events/${eventId}/pairwise/next?trackId=${forTrackId}`)
      .then(setPair)
      .catch((e) => {
        if (e instanceof ApiError && e.code === "ALL_PAIRS_COMPARED") {
          setDone(true);
          return;
        }
        setError(e instanceof ApiError ? e.message : "Failed to load a pair to compare");
      });
  };

  useEffect(() => {
    loadNext(trackId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  async function vote(winner: "a" | "b" | "tie") {
    if (!pair || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/events/${eventId}/pairwise/compare`, {
        trackId,
        submissionA: pair.submissionA.id,
        submissionB: pair.submissionB.id,
        winner,
      });
      setComparedCount((n) => n + 1);
      loadNext(trackId);
    } catch (e) {
      // ALREADY_COMPARED is the backend's own defense-in-depth guard for
      // this same pair -- shouldn't normally be reachable through this
      // UI (getNextPair already stops offering a compared pair first),
      // but if a race ever does hit it, treat it the same as "someone
      // else already recorded this" rather than a real failure: just
      // move on to whatever's actually next instead of showing red text
      // for something the judge didn't do anything wrong to cause.
      if (e instanceof ApiError && e.code === "ALREADY_COMPARED") {
        loadNext(trackId);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Failed to record that comparison");
    } finally {
      setBusy(false);
    }
  }

  if (tracks.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted">No tracks configured for this event yet.</p>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-h1 font-semibold text-ink">Pairwise comparison</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Pick whichever project is better. There&rsquo;s no absolute score to get right here, just
        keep comparing and a ranking builds itself from your choices.
      </p>

      {tracks.length > 1 && (
        <div className="mt-4">
          <label className="block text-xs font-medium tracking-wide text-ink">Track</label>
          <select
            data-testid="pairwise-track-select"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
          >
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="mt-3 text-xs leading-normal text-muted" data-testid="pairwise-compared-count">
        {comparedCount} comparison{comparedCount === 1 ? "" : "s"} made this session.
      </p>

      {error && (
        <p data-testid="pairwise-error" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {done ? (
        <p data-testid="pairwise-done" className="mt-4 text-sm leading-relaxed text-ink">
          You&rsquo;ve compared every pair in this track. Nothing left to judge here
          {tracks.length > 1
            ? ". Pick another track above, or check back once more submissions come in."
            : "."}
        </p>
      ) : !pair ? (
        !error && <LoadingState className="mt-4" />
      ) : (
        <>
          {/* Found live: this card only ever showed name/tagline -- no way
              to actually review either project before picking one. First
              fix inlined the full description + tags + links onto the
              card itself, but that made a narrow, half-width card look
              cramped -- description and links stacked so tight they read
              as one dense block ("congested"), and with a real event's
              submissions rarely having every one of repo/live/video URLs
              set, whichever were missing just left the card feeling even
              more lopsided. Reworked instead to keep the card itself lean
              (name, tagline, tags for a quick scan) and link out to the
              existing full submission detail page for everything else --
              same page the public gallery already uses, in a new tab so
              the comparison flow isn't interrupted, and the one place that
              needed a single, obvious "open" affordance in the first
              place. Each card is a flex column with the pick button
              pinned to the bottom (mt-auto) rather than immediately after
              the tagline, so two cards with different amounts of content
              don't leave the buttons sitting at different heights next to
              each other -- the grid's default row-stretch plus h-full on
              each card is what makes that alignment work even when one
              project has much more to show than the other. */}
          <div className="mt-4 grid items-stretch gap-4 sm:grid-cols-2">
            {(
              [
                ["a", pair.submissionA],
                ["b", pair.submissionB],
              ] as const
            ).map(([side, sub]) => (
              <div
                key={sub.id}
                className="flex h-full flex-col overflow-hidden rounded-xl border border-line"
              >
                <div className="h-32 shrink-0">
                  <ThumbnailOrInitials thumbnailUrl={sub.thumbnailUrl} name={sub.name} />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="font-semibold text-ink">{sub.name}</div>
                  {sub.tagline && (
                    <p className="mt-1 text-sm leading-relaxed text-muted">{sub.tagline}</p>
                  )}
                  {sub.techTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {sub.techTags.map((t) => (
                        <TagPill key={t}>{t}</TagPill>
                      ))}
                    </div>
                  )}
                  {/* Found live ("alignment of the view full submission
                      button is very congested... if one project has a
                      bigger description and one has smaller, the button is
                      not aligned properly"): mt-auto was only ever on the
                      pick button, so it stayed bottom-aligned across the
                      two cards, but the link right above it still sat
                      wherever the variable-length tagline/tags happened to
                      end -- misaligned between two cards whenever one had
                      more to show than the other. Grouping the link and
                      the button into one mt-auto block fixes both at once:
                      the whole block is what gets pushed to the bottom
                      (using the flex-1 space the shorter card's lighter
                      content above leaves free), and the link sits at a
                      fixed distance above the button within it either way. */}
                  <div className="mt-auto pt-3">
                    <a
                      href={`/submissions/${sub.id}`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`pairwise-open-${side}`}
                      className="block text-xs font-medium text-accent hover:underline"
                    >
                      Open full submission ↗
                    </a>
                    <button
                      disabled={busy}
                      data-testid={`pairwise-pick-${side}`}
                      onClick={() => vote(side)}
                      className="mt-3 w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
                    >
                      This one is better
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            disabled={busy}
            data-testid="pairwise-tie"
            onClick={() => vote("tie")}
            className="mt-4 w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50 sm:w-auto"
          >
            Can&rsquo;t tell / tie
          </button>
        </>
      )}
    </div>
  );
}
