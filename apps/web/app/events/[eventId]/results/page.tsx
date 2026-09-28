"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingState } from "../../../../components/ui";
import { api, ApiError } from "../../../../lib/api";

// Found live ("only the submission id is showing up... no one will be
// able to make out what this even means"): every row here used to carry
// nothing but submissionId, rendered as an 8-character truncated hex
// string with no way to tell which actual project or team it was. The
// backend now joins submission name and team name into every ranking/
// tally row it assembles (ResultsService.assemble/submissionInfoMap), so
// every one of these interfaces just needs the two extra fields.
interface RubricRanking {
  submissionId: string;
  submissionName: string;
  teamName: string;
  rawMean: string;
  normalizedMean: string;
  rank: number;
}
interface TrackRanking {
  trackId: string;
  trackName: string;
  rankings: RubricRanking[];
}
interface RubricResult {
  rubricId: string;
  rubricName: string;
  trackId: string | null;
  rankings: RubricRanking[];
  trackRankings: TrackRanking[];
}
interface PairwiseRanking {
  submissionId: string;
  submissionName: string;
  teamName: string;
  btStrength: string;
  rank: number;
  ciLow: string;
  ciHigh: string;
}
interface PairwiseResult {
  trackId: string;
  trackName: string;
  rankings: PairwiseRanking[];
}
interface VoteTallyRow {
  submissionId: string;
  submissionName: string;
  teamName: string;
  totalVotes: number;
  voterCount: number;
}
interface ResultsResponse {
  rubricResults: RubricResult[];
  pairwiseResults: PairwiseResult[];
  voteTally: VoteTallyRow[];
}

// Shared by every table below: submission name as the primary line, team
// name underneath it -- both visible at once, requested explicitly ("the
// name of the project and team name should be visible in results").
function SubmissionCell({ name, teamName }: { name: string; teamName: string }) {
  return (
    <td className="py-1">
      <div className="font-medium text-ink">{name}</div>
      <div className="text-xs text-muted">{teamName}</div>
    </td>
  );
}

export default function ResultsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ResultsResponse>(`/events/${eventId}/results`)
      .then(setResults)
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 403
            ? "Results have not been published yet."
            : "Failed to load results",
        ),
      );
  }, [eventId]);

  if (error) {
    return <p className="text-sm text-muted">{error}</p>;
  }
  if (!results) {
    return <LoadingState />;
  }

  const pairwiseWithRankings = results.pairwiseResults.filter((p) => p.rankings.length > 0);
  const sectionCount = results.rubricResults.length + pairwiseWithRankings.length + 1;

  return (
    <div className="space-y-10">
      <h1 className="text-h1 font-semibold text-ink">Results</h1>

      {sectionCount > 3 && (
        <nav className="-mt-6 flex flex-wrap gap-1.5" aria-label="Jump to section">
          {results.rubricResults.map((r) => (
            <a
              key={r.rubricId}
              href={`#rubric-${r.rubricId}`}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
            >
              {r.rubricName}
            </a>
          ))}
          {pairwiseWithRankings.map((p) => (
            <a
              key={p.trackId}
              href={`#pairwise-${p.trackId}`}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
            >
              {p.trackName} (pairwise)
            </a>
          ))}
          <a
            href="#votes"
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
          >
            Community votes
          </a>
        </nav>
      )}

      {results.rubricResults.map((r) => (
        <section key={r.rubricId} id={`rubric-${r.rubricId}`} className="scroll-mt-4">
          <h2 className="text-h2 font-semibold text-ink">{r.rubricName}</h2>
          <h3 className="mt-4 text-sm font-semibold tracking-wide text-muted">Overall</h3>
          <table className="mt-2 w-full max-w-lg text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-1">Rank</th>
                <th className="pb-1">Submission</th>
                <th className="pb-1">Raw</th>
                <th className="pb-1">Normalized</th>
              </tr>
            </thead>
            <tbody>
              {r.rankings.map((row) => (
                <tr key={row.submissionId} className="border-t border-line">
                  <td className="py-1">{row.rank}</td>
                  <SubmissionCell name={row.submissionName} teamName={row.teamName} />
                  <td className="py-1">{Number(row.rawMean).toFixed(2)}</td>
                  <td className="py-1">{Number(row.normalizedMean).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Requested explicitly: the overall ranking above ranks every
              submission on one scale regardless of track, but says
              nothing about how a submission placed within its own track
              -- the same underlying scores, re-ranked per track. */}
          {r.trackRankings.map((t) => (
            <div key={t.trackId} className="mt-6">
              <h3 className="text-sm font-semibold tracking-wide text-muted">{t.trackName}</h3>
              <table className="mt-2 w-full max-w-lg text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pb-1">Track rank</th>
                    <th className="pb-1">Submission</th>
                    <th className="pb-1">Raw</th>
                    <th className="pb-1">Normalized</th>
                  </tr>
                </thead>
                <tbody>
                  {t.rankings.map((row) => (
                    <tr key={row.submissionId} className="border-t border-line">
                      <td className="py-1">{row.rank}</td>
                      <SubmissionCell name={row.submissionName} teamName={row.teamName} />
                      <td className="py-1">{Number(row.rawMean).toFixed(2)}</td>
                      <td className="py-1">{Number(row.normalizedMean).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ))}

      {pairwiseWithRankings.length > 0 && (
        <p className="max-w-lg text-xs leading-relaxed text-muted">
          Pairwise rankings are shown per track only, with no combined &ldquo;overall&rdquo; ranking
          across tracks (unlike rubric mode&rsquo;s overall + track breakdown above) &mdash; a
          Bradley-Terry strength is only ever estimated within one track&rsquo;s own comparison
          graph, so there&rsquo;s no mathematically meaningful way to put two different
          tracks&rsquo; strengths on the same scale.
        </p>
      )}

      {results.pairwiseResults
        .filter((p) => p.rankings.length > 0)
        .map((p) => (
          <section key={p.trackId} id={`pairwise-${p.trackId}`} className="scroll-mt-4">
            <h2 className="text-h2 font-semibold text-ink">{p.trackName} (pairwise)</h2>
            <table className="mt-3 w-full max-w-lg text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-1">Rank</th>
                  <th className="pb-1">Submission</th>
                  <th className="pb-1">Strength</th>
                  <th className="pb-1">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {p.rankings.map((row) => (
                  <tr key={row.submissionId} className="border-t border-line">
                    <td className="py-1">{row.rank}</td>
                    <SubmissionCell name={row.submissionName} teamName={row.teamName} />
                    <td className="py-1">{Number(row.btStrength).toFixed(3)}</td>
                    <td className="py-1">
                      [{Number(row.ciLow).toFixed(2)}, {Number(row.ciHigh).toFixed(2)}]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

      <section id="votes" className="scroll-mt-4">
        <h2 className="text-h2 font-semibold text-ink">Community votes</h2>
        {results.voteTally.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-muted">No votes cast.</p>
        ) : (
          <table className="mt-3 w-full max-w-lg text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-1">Submission</th>
                <th className="pb-1">Total votes</th>
                <th className="pb-1">Voters</th>
              </tr>
            </thead>
            <tbody>
              {results.voteTally.map((row) => (
                <tr key={row.submissionId} className="border-t border-line">
                  <SubmissionCell name={row.submissionName} teamName={row.teamName} />
                  <td className="py-1">{row.totalVotes}</td>
                  <td className="py-1">{row.voterCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
