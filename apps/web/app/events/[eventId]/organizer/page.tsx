"use client";

import type { Event, Prize, Rubric, RubricCriterion, Track } from "@hackpulse/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "../../../../lib/api";

const GALLERY_VISIBILITIES = ["open", "participants_only", "hidden"] as const;
const VOTING_MODES = ["disabled", "single_vote", "quadratic"] as const;
const VOTING_ACCESS_LEVELS = ["open_link", "email_gated", "authenticated"] as const;
const SCORING_MODES = ["rubric", "pairwise"] as const;

type TabId = "overview" | "setup" | "judges" | "results";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "setup", label: "Setup" },
  { id: "judges", label: "Judges" },
  { id: "results", label: "Results" },
];

interface JudgeRow {
  id: string;
  userId: string;
  userName: string;
  trackIds: string[];
}

type RubricWithCriteria = Rubric & { criteria: RubricCriterion[] };

export default function OrganizerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [tab, setTab] = useState<TabId>("overview");
  const [event, setEvent] = useState<Event | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rubrics, setRubrics] = useState<RubricWithCriteria[]>([]);
  const [judges, setJudges] = useState<JudgeRow[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    api
      .get<Event>(`/events/${eventId}`)
      .then(setEvent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load event"));
    api
      .get<Track[]>(`/events/${eventId}/tracks`)
      .then(setTracks)
      .catch(() => {});
    api
      .get<RubricWithCriteria[]>(`/events/${eventId}/judging/rubrics`)
      .then(setRubrics)
      .catch(() => {});
    api
      .get<JudgeRow[]>(`/events/${eventId}/judges`)
      .then(setJudges)
      .catch(() => {});
    api
      .get<Prize[]>(`/events/${eventId}/prizes`)
      .then(setPrizes)
      .catch(() => {});
  };

  useEffect(load, [eventId]);

  if (!event) {
    return error ? (
      <p className="text-sm text-danger">{error}</p>
    ) : (
      <p className="text-sm text-muted">Loading…</p>
    );
  }

  return (
    <div>
      <h1 className="text-h1 font-semibold text-ink">Organizer dashboard</h1>
      <p className="mt-1 text-sm text-muted">{event.name}</p>

      <div className="mt-4 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-accent text-accent-dark"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && <p className="mt-4 text-sm text-success">{message}</p>}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6">
        {tab === "overview" && (
          <OverviewTab
            event={event}
            onSaved={(e) => {
              setEvent(e);
              setMessage("Saved.");
            }}
            onError={setError}
          />
        )}
        {tab === "setup" && (
          <SetupTab
            eventId={eventId}
            tracks={tracks}
            rubrics={rubrics}
            prizes={prizes}
            onChange={load}
            onError={setError}
          />
        )}
        {tab === "judges" && (
          <JudgesTab
            eventId={eventId}
            tracks={tracks}
            judges={judges}
            onChange={load}
            onError={setError}
          />
        )}
        {tab === "results" && <ResultsTab eventId={eventId} />}
      </div>
    </div>
  );
}

function EventSettingSelect({
  label,
  testId,
  eventId,
  field,
  value,
  options,
  onSaved,
  onError,
}: {
  label: string;
  testId: string;
  eventId: string;
  field: string;
  value: string;
  options: readonly string[];
  onSaved: (e: Event) => void;
  onError: (msg: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium tracking-wide text-muted">{label}</label>
      <select
        data-testid={testId}
        value={value}
        onChange={async (e) => {
          try {
            const updated = await api.patch<Event>(`/events/${eventId}`, {
              [field]: e.target.value,
            });
            onSaved(updated);
          } catch (err) {
            onError(err instanceof ApiError ? err.message : "Failed to save");
          }
        }}
        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {v.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

function OverviewTab({
  event,
  onSaved,
  onError,
}: {
  event: Event;
  onSaved: (e: Event) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(event.name);
  const [description, setDescription] = useState(event.description);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api.patch<Event>(`/events/${event.id}`, { name, description });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      <p className="text-sm leading-relaxed text-muted">
        Status: <span className="font-medium text-ink">{event.displayStatus.replace(/_/g, " ")}</span>
      </p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Description</label>
          <textarea
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          Save
        </button>
      </form>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <EventSettingSelect
          label="Scoring mode"
          testId="event-scoring-select"
          eventId={event.id}
          field="scoringMode"
          value={event.scoringMode}
          options={SCORING_MODES}
          onSaved={onSaved}
          onError={onError}
        />
        <EventSettingSelect
          label="Gallery visibility"
          testId="event-gallery-select"
          eventId={event.id}
          field="galleryVisibility"
          value={event.galleryVisibility}
          options={GALLERY_VISIBILITIES}
          onSaved={onSaved}
          onError={onError}
        />
        <EventSettingSelect
          label="Voting mode"
          testId="event-voting-select"
          eventId={event.id}
          field="votingMode"
          value={event.votingMode}
          options={VOTING_MODES}
          onSaved={onSaved}
          onError={onError}
        />
        <EventSettingSelect
          label="Voting access"
          testId="event-voting-access-select"
          eventId={event.id}
          field="votingAccess"
          value={event.votingAccess}
          options={VOTING_ACCESS_LEVELS}
          onSaved={onSaved}
          onError={onError}
        />
      </div>
    </div>
  );
}

function SetupTab({
  eventId,
  tracks,
  rubrics,
  prizes,
  onChange,
  onError,
}: {
  eventId: string;
  tracks: Track[];
  rubrics: RubricWithCriteria[];
  prizes: Prize[];
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [trackName, setTrackName] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [criterionRows, setCriterionRows] = useState([{ name: "", weight: "1" }]);
  const [prizeName, setPrizeName] = useState("");
  const [prizeTrackId, setPrizeTrackId] = useState("");
  const [prizeWinnerCount, setPrizeWinnerCount] = useState(1);
  const [busy, setBusy] = useState(false);

  async function createTrack(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/tracks`, { name: trackName });
      setTrackName("");
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add track");
    } finally {
      setBusy(false);
    }
  }

  async function createRubric(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/judging/rubrics`, {
        name: rubricName,
        criteria: criterionRows
          .filter((c) => c.name.trim())
          .map((c) => ({ name: c.name, weight: Number(c.weight) })),
      });
      setRubricName("");
      setCriterionRows([{ name: "", weight: "1" }]);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add rubric");
    } finally {
      setBusy(false);
    }
  }

  async function createPrize(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/prizes`, {
        name: prizeName,
        trackId: prizeTrackId || null,
        winnerCount: prizeWinnerCount,
      });
      setPrizeName("");
      setPrizeTrackId("");
      setPrizeWinnerCount(1);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to add prize");
    } finally {
      setBusy(false);
    }
  }

  async function removePrize(prizeId: string) {
    setBusy(true);
    try {
      await api.delete(`/events/${eventId}/prizes/${prizeId}`);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to remove prize");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div>
        <h2 className="text-h2 font-semibold text-ink">Tracks</h2>
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {tracks.map((t) => (
            <li key={t.id}>{t.name}</li>
          ))}
        </ul>
        <form onSubmit={createTrack} className="mt-4 flex gap-2">
          <input
            required
            placeholder="Track name"
            value={trackName}
            onChange={(e) => setTrackName(e.target.value)}
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-h2 font-semibold text-ink">Rubrics</h2>
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {rubrics.map((r) => (
            <li key={r.id}>
              {r.name}{" "}
              <span className="text-muted">({r.criteria.length} criteria)</span>
            </li>
          ))}
        </ul>
        <form onSubmit={createRubric} className="mt-4 space-y-2">
          <input
            required
            placeholder="Rubric name"
            value={rubricName}
            onChange={(e) => setRubricName(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          {criterionRows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                required
                placeholder="Criterion name"
                value={row.name}
                onChange={(e) => {
                  const next = [...criterionRows];
                  next[i] = { ...next[i], name: e.target.value };
                  setCriterionRows(next);
                }}
                className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
              />
              <input
                required
                type="number"
                step="0.01"
                min="0"
                max="1"
                placeholder="Weight"
                value={row.weight}
                onChange={(e) => {
                  const next = [...criterionRows];
                  next[i] = { ...next[i], weight: e.target.value };
                  setCriterionRows(next);
                }}
                className="w-24 rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCriterionRows([...criterionRows, { name: "", weight: "0" }])}
            className="text-sm text-accent hover:underline"
          >
            + Add criterion
          </button>
          <button
            type="submit"
            disabled={busy}
            className="block rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            Create rubric
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-h2 font-semibold text-ink">Prizes</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink">
          {prizes.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span>
                {p.name}{" "}
                <span className="text-muted">
                  ({p.winnerCount} winner{p.winnerCount !== 1 ? "s" : ""}
                  {p.trackId ? `, ${tracks.find((t) => t.id === p.trackId)?.name ?? "track"}` : ""})
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => removePrize(p.id)}
                className="text-xs text-danger hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={createPrize} className="mt-4 space-y-2">
          <input
            required
            placeholder="Prize name"
            value={prizeName}
            onChange={(e) => setPrizeName(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          <select
            value={prizeTrackId}
            onChange={(e) => setPrizeTrackId(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          >
            <option value="">Overall (no track)</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium tracking-wide text-muted">Winners</label>
            <input
              required
              type="number"
              min={1}
              value={prizeWinnerCount}
              onChange={(e) => setPrizeWinnerCount(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded-md border border-line px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            Add prize
          </button>
        </form>
      </div>
    </div>
  );
}

function JudgesTab({
  eventId,
  tracks,
  judges,
  onChange,
  onError,
}: {
  eventId: string;
  tracks: Track[];
  judges: JudgeRow[];
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggleTrack(id: string) {
    setSelectedTracks((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/judges`, { email, trackIds: selectedTracks });
      setEmail("");
      setSelectedTracks([]);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to invite judge");
    } finally {
      setBusy(false);
    }
  }

  async function selfJudge() {
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/judges/self`, { trackIds: selectedTracks });
      setSelectedTracks([]);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to self-judge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      <ul className="space-y-1 text-sm text-ink">
        {judges.map((j) => (
          <li key={j.id}>{j.userName}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {tracks.map((t) => (
          <label key={t.id} className="flex items-center gap-1 text-sm text-ink">
            <input
              type="checkbox"
              checked={selectedTracks.includes(t.id)}
              onChange={() => toggleTrack(t.id)}
            />
            {t.name}
          </label>
        ))}
      </div>
      <form onSubmit={invite} className="mt-4 flex gap-2">
        <input
          required
          type="email"
          placeholder="Judge email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || selectedTracks.length === 0}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          Invite
        </button>
      </form>
      <button
        type="button"
        onClick={selfJudge}
        disabled={busy || selectedTracks.length === 0}
        className="mt-2 rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
      >
        Judge this myself
      </button>
    </div>
  );
}

function ResultsTab({ eventId }: { eventId: string }) {
  const [unjudgedCount, setUnjudgedCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ id: string }[]>(`/events/${eventId}/results/unjudged`)
      .then((rows) => setUnjudgedCount(rows.length))
      .catch(() => {});
  }, [eventId]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/events/${eventId}/results/publish`);
      setMessage("Results published.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to publish results");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg">
      {unjudgedCount !== null && unjudgedCount > 0 && (
        <p className="mb-4 text-sm leading-relaxed text-warning">
          {unjudgedCount} submission{unjudgedCount === 1 ? "" : "s"} not yet fully judged.
        </p>
      )}
      {message && <p className="mb-4 text-sm text-success">{message}</p>}
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
      >
        Publish results
      </button>
    </div>
  );
}
