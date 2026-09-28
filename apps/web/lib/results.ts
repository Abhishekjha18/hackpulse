// Shared between the event page's placement/win banners and the
// notifications bell's rank/win items — both need the exact same
// "what's my placement, did I win a prize" computation against the same
// /results response, and having it in two places risked them drifting
// apart. See REQUIREMENTS.md's FR-RESULT entries for the underlying rule:
// every participant gets their placement once results publish, a prize
// win is a separate fact driven by each prize's own winnerCount.
import type { Prize } from "@hackpulse/shared";

export interface RankingRow {
  submissionId: string;
  rank: number;
}
export interface TrackRanking {
  trackId: string;
  trackName: string;
  rankings: RankingRow[];
}
export interface ResultsResponse {
  rubricResults: {
    rubricName: string;
    trackId: string | null;
    rankings: RankingRow[];
    trackRankings: TrackRanking[];
  }[];
  pairwiseResults: { trackId: string; trackName: string; rankings: RankingRow[] }[];
}
export interface Placement {
  label: string;
  // null for the event-wide "Overall" placement; a real track id for a
  // track placement. Carried through (not just the display label) so a
  // prize's own trackId can be matched against it directly.
  trackId: string | null;
  rank: number;
  total: number;
}

// One placement per ranking group (overall + each track) the given
// submission ids appear in.
export function computePlacements(mineIds: Set<string>, results: ResultsResponse): Placement[] {
  const placements: Placement[] = [];
  // A rubric scoped to a specific track (trackId set) has the same
  // rankings as its own trackRankings entry for that track, so its
  // "overall" is skipped here to avoid showing the same placement twice
  // under two different labels.
  for (const r of results.rubricResults) {
    if (r.trackId !== null) {
      continue;
    }
    const row = r.rankings.find((x) => mineIds.has(x.submissionId));
    if (row) {
      placements.push({
        label: "Overall",
        trackId: null,
        rank: row.rank,
        total: r.rankings.length,
      });
    }
  }
  for (const r of results.rubricResults) {
    for (const t of r.trackRankings) {
      const row = t.rankings.find((x) => mineIds.has(x.submissionId));
      if (row) {
        placements.push({
          label: t.trackName,
          trackId: t.trackId,
          rank: row.rank,
          total: t.rankings.length,
        });
      }
    }
  }
  for (const p of results.pairwiseResults) {
    const row = p.rankings.find((x) => mineIds.has(x.submissionId));
    if (row) {
      placements.push({
        label: p.trackName,
        trackId: p.trackId,
        rank: row.rank,
        total: p.rankings.length,
      });
    }
  }
  return placements;
}

// A prize's own trackId (null for "overall", a real track id otherwise)
// matches a placement's trackId directly.
export function computeWonPrizes(placements: Placement[], prizes: Prize[]): Prize[] {
  return prizes.filter((prize) => {
    const placement = placements.find((pl) => pl.trackId === prize.trackId);
    return !!placement && placement.rank <= prize.winnerCount;
  });
}
