"use client";

import type { Event, Rubric, RubricCriterion, Submission, Track } from "@hackpulse/shared";
import { JUDGE_ASSIGNMENT_STATUS, SCORING_MODE } from "@hackpulse/shared/constants";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PairwiseJudging } from "../../../../components/pairwise-judging";
import { LoadingState, TagPill, ThumbnailOrInitials } from "../../../../components/ui";
import { api, ApiError } from "../../../../lib/api";
interface QueueEntry {
  assignment: { id: string; status: string; submissionId: string };
  submission: Submission;
}

type RubricWithCriteria = Rubric & { criteria: RubricCriterion[] };

export default function JudgePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = useState<QueueEntry[] | null>(null);
  const [rubrics, setRubrics] = useState<RubricWithCriteria[]>([]);
  const [active, setActive] = useState<QueueEntry | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadQueue = () => {
    api
      .get<QueueEntry[]>(`/events/${eventId}/judging/queue`)
      .then(setQueue)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load queue"));
  };

  useEffect(() => {
    api
      .get<Event>(`/events/${eventId}`)
      .then(setEvent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load event"));
    api
      .get<Track[]>(`/events/${eventId}/tracks`)
      .then(setTracks)
      .catch(() => {});
    loadQueue();
    api
      .get<RubricWithCriteria[]>(`/events/${eventId}/judging/rubrics`)
      .then(setRubrics)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  function rubricFor(submission: Submission): RubricWithCriteria | undefined {
    return (
      rubrics.find((r) => r.trackId === submission.trackId) ??
      rubrics.find((r) => r.trackId === null)
    );
  }

  function openEntry(entry: QueueEntry) {
    setActive(entry);
    setValues({});
    setFeedback("");
    setMessage(null);
    setError(null);
  }

  async function submitScore(rubric: RubricWithCriteria, isFinal: boolean) {
    if (!active) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const criterionScores = rubric.criteria.map((c) => ({
        rubricCriterionId: c.id,
        value: values[c.id] ?? rubric.scaleMin,
      }));
      await api.put(`/judging/scores/${active.assignment.id}`, {
        overallFeedback: feedback || null,
        criterionScores,
      });
      if (isFinal) {
        await api.post(`/judging/scores/${active.assignment.id}/submit`);
        setMessage("Score submitted.");
      } else {
        setMessage("Draft saved.");
      }
      loadQueue();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save score");
    } finally {
      setBusy(false);
    }
  }

  if (error && !queue) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!queue || !event) {
    return <LoadingState />;
  }

  // scoringMode is event-wide, not per-track: every track uses either
  // rubric scoring or pairwise comparison, never a mix.
  if (event.scoringMode === SCORING_MODE.PAIRWISE) {
    return <PairwiseJudging eventId={eventId} tracks={tracks} />;
  }

  if (active) {
    const rubric = rubricFor(active.submission);
    return (
      <div className="max-w-xl">
        <button onClick={() => setActive(null)} className="text-sm text-accent hover:underline">
          ← Back to queue
        </button>
        {/* Previously showed only name + description, with no repo/live/demo
            links, tags, or images: a judge had no real way to evaluate the
            project they were scoring. */}
        <div className="mt-3 h-40 overflow-hidden rounded-xl border border-line">
          <ThumbnailOrInitials
            thumbnailUrl={active.submission.thumbnailUrl}
            name={active.submission.name}
          />
        </div>
        <h1 className="mt-4 text-h1 font-semibold text-ink">{active.submission.name}</h1>
        {active.submission.tagline && (
          <p className="mt-1 text-sm leading-relaxed text-muted">{active.submission.tagline}</p>
        )}
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {active.submission.description}
        </p>

        {active.submission.techTags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {active.submission.techTags.map((t) => (
              <TagPill key={t}>{t}</TagPill>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {active.submission.repoUrl && (
            <a
              href={active.submission.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Repository →
            </a>
          )}
          {active.submission.liveUrl && (
            <a
              href={active.submission.liveUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Live demo →
            </a>
          )}
          {active.submission.demoVideoUrl && (
            <a
              href={active.submission.demoVideoUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Demo video →
            </a>
          )}
        </div>

        {active.submission.galleryImageUrls.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {active.submission.galleryImageUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                className="h-24 w-32 shrink-0 rounded-md border border-line object-cover"
              />
            ))}
          </div>
        )}

        {!rubric ? (
          <p className="mt-6 text-sm leading-relaxed text-muted">
            No rubric configured for this track yet.
          </p>
        ) : (
          <div className="mt-6 space-y-4">
            {rubric.criteria.map((c) => (
              <div key={c.id}>
                <label className="block text-xs font-medium tracking-wide text-ink">
                  {c.name}{" "}
                  <span className="text-muted">({(Number(c.weight) * 100).toFixed(0)}%)</span>
                </label>
                <input
                  type="range"
                  min={rubric.scaleMin}
                  max={rubric.scaleMax}
                  data-testid={`score-slider-${c.name}`}
                  value={values[c.id] ?? rubric.scaleMin}
                  onChange={(e) => setValues({ ...values, [c.id]: Number(e.target.value) })}
                  className="mt-1 w-full"
                />
                <div className="text-xs leading-normal text-muted">
                  {values[c.id] ?? rubric.scaleMin}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Overall feedback
              </label>
              <textarea
                rows={3}
                data-testid="score-feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <p data-testid="score-error" className="text-sm text-danger">
                {error}
              </p>
            )}
            {message && (
              <p data-testid="score-message" className="text-sm text-success">
                {message}
              </p>
            )}

            <div className="flex gap-3">
              <button
                disabled={busy}
                onClick={() => submitScore(rubric, false)}
                data-testid="score-save-draft"
                className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
              >
                Save draft
              </button>
              <button
                disabled={busy}
                onClick={() => submitScore(rubric, true)}
                data-testid="score-submit-final"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
              >
                Submit score
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-h1 font-semibold text-ink">Your judging queue</h1>
      {queue.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          No submissions assigned to you yet.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {queue.map((entry) => (
            <button
              key={entry.assignment.id}
              onClick={() => openEntry(entry)}
              data-testid="queue-item"
              className="flex w-full items-center justify-between rounded-lg border border-line bg-surface p-4 text-left hover:border-accent"
            >
              <div>
                <div className="text-sm font-medium text-ink">{entry.submission.name}</div>
                <div className="text-xs leading-normal text-muted">{entry.submission.tagline}</div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  entry.assignment.status === JUDGE_ASSIGNMENT_STATUS.COMPLETED
                    ? "bg-success-soft text-success"
                    : entry.assignment.status === JUDGE_ASSIGNMENT_STATUS.IN_PROGRESS
                      ? "bg-warning-soft text-warning"
                      : "bg-surface-alt text-muted"
                }`}
              >
                {entry.assignment.status.replace("_", " ")}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
