"use client";

import type {
  Event,
  EventRoleListEntry,
  Prize,
  Rubric,
  RubricCriterion,
  Submission,
  Team,
  TeamMember,
  Track,
} from "@hackpulse/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "../../../../components/ui";
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

type RubricWithCriteria = Rubric & { criteria: RubricCriterion[]; archived: boolean };

export default function OrganizerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [tab, setTab] = useState<TabId>("overview");
  const [event, setEvent] = useState<Event | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [rubrics, setRubrics] = useState<RubricWithCriteria[]>([]);
  const [judges, setJudges] = useState<EventRoleListEntry[]>([]);
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
      .get<EventRoleListEntry[]>(`/events/${eventId}/judges`)
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
        {tab === "results" && <ResultsTab eventId={eventId} judges={judges} rubrics={rubrics} />}
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
        Status:{" "}
        <span className="font-medium text-ink">{event.displayStatus.replace(/_/g, " ")}</span>
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

      <div className="mt-8 grid gap-x-4 gap-y-5 sm:grid-cols-2">
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

      <div className="mt-4 max-w-2xl">
        <label className="block text-xs font-medium tracking-wide text-muted">
          Banner image URL
        </label>
        <p className="mt-0.5 text-[11px] text-muted">
          Shown at the top of the event page and on its card in the events list and homepage. Leave
          blank for an auto-generated default banner. Same posture as a submission&rsquo;s thumbnail
          image: a URL you supply, not a file upload.
        </p>
        <input
          type="url"
          placeholder="https://…"
          data-testid="event-banner-url"
          defaultValue={event.bannerImageUrl ?? ""}
          onBlur={async (e) => {
            try {
              const updated = await api.patch<Event>(`/events/${event.id}`, {
                bannerImageUrl: e.target.value || null,
              });
              onSaved(updated);
            } catch (err) {
              onError(err instanceof ApiError ? err.message : "Failed to save banner image");
            }
          }}
          className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
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

  async function removeTrack(trackId: string, name: string) {
    if (!window.confirm(`Remove track "${name}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/events/${eventId}/tracks/${trackId}`);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to remove track");
    } finally {
      setBusy(false);
    }
  }

  async function removeRubric(rubricId: string, name: string) {
    if (!window.confirm(`Remove rubric "${name}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/events/${eventId}/judging/rubrics/${rubricId}`);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to remove rubric");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <div>
        <h2 className="text-h2 font-semibold text-ink">Tracks</h2>
        <ul data-testid="track-list" className="mt-3 space-y-1 text-sm text-ink">
          {tracks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2">
              <span>{t.name}</span>
              <button
                type="button"
                data-testid={`track-remove-${t.id}`}
                disabled={busy}
                onClick={() => removeTrack(t.id, t.name)}
                className="text-xs text-danger hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
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
        <ul data-testid="rubric-list" className="mt-3 space-y-1 text-sm text-ink">
          {rubrics.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                {r.name} <span className="text-muted">({r.criteria.length} criteria)</span>
              </span>
              <button
                type="button"
                data-testid={`rubric-remove-${r.id}`}
                disabled={busy}
                onClick={() => removeRubric(r.id, r.name)}
                className="text-xs text-danger hover:underline disabled:opacity-50"
              >
                Remove
              </button>
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
  judges: EventRoleListEntry[];
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [selectedTracks, setSelectedTracks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [assignTrackId, setAssignTrackId] = useState("");
  const [minJudges, setMinJudges] = useState(2);
  const [unassignedCount, setUnassignedCount] = useState(0);

  const [manualTrackId, setManualTrackId] = useState("");
  const [manualSubmissions, setManualSubmissions] = useState<Submission[]>([]);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [selectedJudgeUserIds, setSelectedJudgeUserIds] = useState<string[]>([]);
  const [manualResult, setManualResult] = useState<{
    created: number;
    skipped: { submissionId: string; judgeUserId: string; reason: string }[];
  } | null>(null);

  useEffect(() => {
    api
      .get<{ unassignedCount: number }>(`/events/${eventId}/judging/progress`)
      .then((r) => setUnassignedCount(r.unassignedCount))
      .catch(() => {});
    // Bypasses the public gallery view; already filtered to submitted
    // (assignable) entries.
    api
      .get<{ items: Submission[] }>(`/events/${eventId}/gallery?limit=200`)
      .then((r) => setManualSubmissions(r.items))
      .catch(() => {});
  }, [eventId]);

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

  async function removeJudge(eventRoleId: string, name: string) {
    if (
      !window.confirm(
        `Remove ${name} as a judge? Any of their in-progress or submitted scores will be permanently deleted.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.delete(`/events/${eventId}/judges/${eventRoleId}`);
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to remove judge");
    } finally {
      setBusy(false);
    }
  }

  async function assignAlgorithmic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/events/${eventId}/judging/assignments`, {
        strategy: "algorithmic",
        trackId: assignTrackId,
        minJudgesPerSubmission: minJudges,
      });
      onChange();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to assign judges");
    } finally {
      setBusy(false);
    }
  }

  // Separate from the other actions: needs to inspect the response body
  // (created count, skipped reasons), not just a generic success message.
  // A skipped conflict-of-interest pairing can be force-assigned by
  // calling this again with force: true; a skipped track-scoping pairing
  // can't.
  async function submitManualAssignment(
    submissionIds: string[],
    judgeUserIds: string[],
    force: boolean,
  ) {
    try {
      const result = await api.post<{
        created: unknown[];
        skipped: { submissionId: string; judgeUserId: string; reason: string }[];
      }>(`/events/${eventId}/judging/assignments`, {
        strategy: "manual",
        submissionIds,
        judgeUserIds,
        force,
      });
      setManualResult({ created: result.created.length, skipped: result.skipped });
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Failed to assign");
    }
  }

  return (
    <div className="max-w-lg">
      <ul data-testid="judge-list" className="space-y-1 text-sm text-ink">
        {judges.map((j) => (
          <li key={j.id} className="flex items-center justify-between gap-2">
            <span>
              {j.name} ({j.email})
              {j.tracks.length > 0 ? ` on ${j.tracks.map((t) => t.name).join(", ")}` : ""}
              {j.status !== "accepted" && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                    j.status === "pending"
                      ? "bg-accent-soft text-accent-dark"
                      : "bg-surface-alt text-muted"
                  }`}
                >
                  {j.status === "pending" ? "Invited, awaiting response" : "Declined"}
                </span>
              )}
            </span>
            {j.status === "accepted" && (
              <button
                type="button"
                data-testid={`judge-remove-${j.id}`}
                disabled={busy}
                onClick={() => removeJudge(j.id, j.name)}
                className="text-xs text-danger hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </li>
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

      <h2 className="mt-8 text-h2 font-semibold text-ink">Assign judges (algorithmic)</h2>
      {unassignedCount > 0 && (
        <p
          data-testid="unassigned-nudge"
          className="mt-1 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink"
        >
          {unassignedCount} submitted {unassignedCount === 1 ? "entry isn't" : "entries aren't"}{" "}
          assigned to a judge yet. Run Assign to include {unassignedCount === 1 ? "it" : "them"}.
        </p>
      )}
      <form onSubmit={assignAlgorithmic} className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium tracking-wide text-muted">Track</label>
          <select
            required
            data-testid="assign-track-select"
            value={assignTrackId}
            onChange={(e) => setAssignTrackId(e.target.value)}
            className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose
            </option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-muted">
            Min judges/submission
          </label>
          <input
            type="number"
            min={1}
            step={1}
            data-testid="assign-min-judges"
            value={minJudges}
            onChange={(e) => {
              const raw = Math.floor(Number(e.target.value));
              setMinJudges(Number.isFinite(raw) ? Math.max(1, raw) : 1);
            }}
            className="mt-1 w-24 rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          data-testid="assign-submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          Assign
        </button>
      </form>

      <h2 className="mt-8 text-h2 font-semibold text-ink">Assign judges (manual)</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pick specific submissions and judges to pair directly. A judge not scoped to a
        submission&rsquo;s track is always skipped; a declared conflict of interest (a shared
        workplace with a team member) is skipped by default but can be forced through individually
        below.
      </p>

      <div className="mt-3">
        <label className="block text-xs font-medium tracking-wide text-muted">
          Filter by track
        </label>
        <select
          data-testid="manual-assign-track-filter"
          value={manualTrackId}
          onChange={(e) => setManualTrackId(e.target.value)}
          className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
        >
          <option value="">All tracks</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Submissions</h3>
          <ul
            data-testid="manual-submission-list"
            className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm"
          >
            {manualSubmissions
              .filter((s) => !manualTrackId || s.trackId === manualTrackId)
              .map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedSubmissionIds.includes(s.id)}
                      onChange={(e) =>
                        setSelectedSubmissionIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.name}
                  </label>
                </li>
              ))}
            {manualSubmissions.filter((s) => !manualTrackId || s.trackId === manualTrackId)
              .length === 0 && (
              <li className="text-xs text-muted">
                No submitted entries{manualTrackId ? " in this track" : ""} yet.
              </li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Judges</h3>
          <ul
            data-testid="manual-judge-list"
            className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-line p-2 text-sm"
          >
            {judges
              .filter((j) => j.status === "accepted")
              .filter((j) => !manualTrackId || j.tracks.some((t) => t.id === manualTrackId))
              .map((j) => (
                <li key={j.userId}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedJudgeUserIds.includes(j.userId)}
                      onChange={(e) =>
                        setSelectedJudgeUserIds((prev) =>
                          e.target.checked
                            ? [...prev, j.userId]
                            : prev.filter((id) => id !== j.userId),
                        )
                      }
                    />
                    {j.name}
                  </label>
                </li>
              ))}
            {judges
              .filter((j) => j.status === "accepted")
              .filter((j) => !manualTrackId || j.tracks.some((t) => t.id === manualTrackId))
              .length === 0 && (
              <li className="text-xs text-muted">
                No accepted judges{manualTrackId ? " scoped to this track" : ""} yet.
              </li>
            )}
          </ul>
        </div>
      </div>

      <button
        type="button"
        data-testid="manual-assign-submit"
        disabled={selectedSubmissionIds.length === 0 || selectedJudgeUserIds.length === 0}
        onClick={() => {
          submitManualAssignment(selectedSubmissionIds, selectedJudgeUserIds, false);
        }}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        Assign selected
      </button>

      {manualResult && (
        <div className="mt-3 rounded-md border border-line bg-surface-alt p-3 text-sm">
          <p>
            {manualResult.created} assignment{manualResult.created === 1 ? "" : "s"} created.
          </p>
          {manualResult.skipped.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {manualResult.skipped.map((s, i) => {
                const sub = manualSubmissions.find((x) => x.id === s.submissionId);
                const judge = judges.find((j) => j.userId === s.judgeUserId);
                const isConflict = s.reason.startsWith("conflict of interest");
                return (
                  <li
                    key={`${s.submissionId}-${s.judgeUserId}-${i}`}
                    className="flex items-center justify-between gap-2 text-xs text-muted"
                  >
                    <span>
                      <strong>{judge?.name ?? s.judgeUserId}</strong> ×{" "}
                      <strong>{sub?.name ?? s.submissionId}</strong>: {s.reason}
                    </span>
                    {isConflict && (
                      <button
                        type="button"
                        data-testid={`manual-force-${s.submissionId}-${s.judgeUserId}`}
                        onClick={() =>
                          submitManualAssignment([s.submissionId], [s.judgeUserId], true)
                        }
                        className="shrink-0 rounded-md border border-line bg-paper px-2 py-1 text-xs font-medium hover:bg-surface-alt"
                      >
                        Force assign
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type TeamForCert = Team & { members: TeamMember[] };

interface OutlierJudge {
  judgeUserId: string;
  judgeName: string;
  scoreCount: number;
  nearZeroVariance: boolean;
  divergesFromPeers: boolean;
  correlationWithPeers: number | null;
}

function ResultsTab({
  eventId,
  judges,
  rubrics,
}: {
  eventId: string;
  judges: EventRoleListEntry[];
  rubrics: RubricWithCriteria[];
}) {
  const [unjudgedCount, setUnjudgedCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [teamsForEvent, setTeamsForEvent] = useState<TeamForCert[]>([]);
  const [certType, setCertType] = useState<"participation" | "winner" | "judge">("participation");
  const [certRecipients, setCertRecipients] = useState<string[]>([]);
  const [outlierJudges, setOutlierJudges] = useState<(OutlierJudge & { rubricName: string })[]>([]);

  useEffect(() => {
    api
      .get<{ id: string }[]>(`/events/${eventId}/results/unjudged`)
      .then((rows) => setUnjudgedCount(rows.length))
      .catch(() => {});
    api
      .get<TeamForCert[]>(`/events/${eventId}/teams`)
      .then(setTeamsForEvent)
      .catch(() => {});
  }, [eventId]);

  // Fans out across every active rubric and tags each flagged judge with
  // which rubric flagged them.
  useEffect(() => {
    const active = rubrics.filter((r) => !r.archived);
    Promise.all(
      active.map((r) =>
        api
          .get<OutlierJudge[]>(`/events/${eventId}/judging/results/outlier-judges?rubricId=${r.id}`)
          .then((rows) => rows.map((row) => ({ ...row, rubricName: r.name })))
          .catch(() => []),
      ),
    ).then((byRubric) => setOutlierJudges(byRubric.flat()));
  }, [eventId, rubrics]);

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

  const recipients =
    certType === "judge"
      ? judges
          .filter((j) => j.status === "accepted")
          .map((j) => ({ userId: j.userId, label: j.name }))
      : teamsForEvent.flatMap((t) =>
          t.members.map((m) => ({ userId: m.userId, label: `${m.userName} (${t.name})` })),
        );

  async function generateCertificates() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/events/${eventId}/certificates/generate`, {
        type: certType,
        recipientIds: certRecipients,
      });
      setMessage(`${certRecipients.length} certificate(s) generated.`);
      setCertRecipients([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate certificates");
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

      <h2 className="mt-8 text-h2 font-semibold text-ink">Certificates</h2>
      <div className="mt-3">
        <label className="block text-xs font-medium tracking-wide text-ink">Type</label>
        <select
          data-testid="certificate-type-select"
          value={certType}
          onChange={(e) => {
            setCertType(e.target.value as typeof certType);
            setCertRecipients([]);
          }}
          className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
        >
          <option value="participation">Participation</option>
          <option value="winner">Winner</option>
          <option value="judge">Judge</option>
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" data-testid="certificate-recipients">
        {recipients.map((r) => {
          const checked = certRecipients.includes(r.userId);
          return (
            <label
              key={r.userId}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium ${
                checked
                  ? "border-accent bg-accent-soft text-accent-dark"
                  : "border-line bg-paper text-muted"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  setCertRecipients((prev) =>
                    checked ? prev.filter((id) => id !== r.userId) : [...prev, r.userId],
                  )
                }
              />
              {r.label}
            </label>
          );
        })}
      </div>

      <button
        type="button"
        disabled={busy || certRecipients.length === 0}
        data-testid="certificate-generate"
        onClick={generateCertificates}
        className="mt-4 rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
      >
        Generate certificates
      </button>

      <h2 className="mt-8 text-h2 font-semibold text-ink">Outlier judges</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Normalization already corrects for a judge who scores consistently high or low or with no
        variance. This is for cases that deserve a human look: a judge whose scores show essentially
        no spread, or whose relative ranking of submissions runs opposite to their peers&rsquo;.
        Flagging isn&rsquo;t a penalty; their scores are still counted.
      </p>
      {outlierJudges.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">No outliers flagged.</p>
      ) : (
        <ul data-testid="outlier-judge-list" className="mt-3 space-y-2 text-sm">
          {outlierJudges.map((o, i) => (
            <li
              key={`${o.judgeUserId}-${o.rubricName}-${i}`}
              data-testid={`outlier-judge-${o.judgeUserId}`}
              className="rounded-md border border-line p-2.5"
            >
              <span className="flex items-center gap-2">
                <Avatar name={o.judgeName} size={20} />
                <strong>{o.judgeName}</strong>
                <span className="text-xs text-muted">
                  {o.rubricName} &middot; {o.scoreCount} score{o.scoreCount === 1 ? "" : "s"}
                </span>
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {o.nearZeroVariance && (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                    Near-zero variance
                  </span>
                )}
                {o.divergesFromPeers && (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                    Diverges from peer consensus (r={o.correlationWithPeers!.toFixed(2)})
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
