"use client";

import type { Event, EventRoleListEntry, Prize, Submission, Track } from "@hackpulse/shared";
import {
  CERTIFICATE_TYPE,
  EVENT_ROLE,
  EVENT_STATUS,
  GALLERY_VISIBILITY,
  INVITE_STATUS,
  SCORING_MODE,
  VOTING_ACCESS,
  VOTING_MODE,
} from "@hackpulse/shared/constants";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Avatar, LoadingState, StatusBadge, useConfirm } from "../../../../components/ui";
import { api, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
// The four statuses a manual-mode organizer moves between directly via the
// status dropdown, in order. results_published (Publish results button
// only) and archived (its own precondition: only once results_published)
// are handled separately, not part of this "one step at a time" sequence.
const REGULAR_MANUAL_STATUSES = [
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.REGISTRATION_OPEN,
  EVENT_STATUS.SUBMISSIONS_OPEN,
  EVENT_STATUS.JUDGING,
] as const;
const GALLERY_VISIBILITIES = [
  GALLERY_VISIBILITY.OPEN,
  GALLERY_VISIBILITY.PARTICIPANTS_ONLY,
  GALLERY_VISIBILITY.HIDDEN,
] as const;
const VOTING_MODES = [
  VOTING_MODE.DISABLED,
  VOTING_MODE.SINGLE_VOTE,
  VOTING_MODE.QUADRATIC,
] as const;
const VOTING_ACCESS_LEVELS = [
  VOTING_ACCESS.OPEN_LINK,
  VOTING_ACCESS.EMAIL_GATED,
  VOTING_ACCESS.AUTHENTICATED,
] as const;
// Reported live: pairwise mode's judging UI (PairwiseJudging, wired into
// the judge page) was fully built, but there was no organizer-facing way
// to actually turn it on -- scoringMode was only ever settable via a
// direct API call, not the dashboard. Same posture as galleryVisibility/
// votingMode right below: freely switchable any time, no backend lock,
// since none exists server-side either.
const SCORING_MODES = ["rubric", "pairwise"] as const;

// Shared by the three event-settings selects below (gallery visibility,
// voting mode, voting access): each is a single-field PATCH with an
// identical shape, differing only in which field and which options.
function EventSettingSelect({
  label,
  testId,
  eventId,
  field,
  value,
  options,
  run,
}: {
  label: string;
  testId: string;
  eventId: string;
  field: string;
  value: string;
  options: readonly string[];
  run: (action: () => Promise<unknown>, successMessage: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium tracking-wide text-muted">{label}</label>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) =>
          run(
            () => api.patch(`/events/${eventId}`, { [field]: e.target.value }),
            `${label} set to "${e.target.value}".`,
          )
        }
        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {v.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

// Shortcuts only, never inserted automatically: one click to add, or
// ignore them entirely and type a custom track name.
const SUGGESTED_TRACKS = [
  "AI/ML",
  "Web & Mobile",
  "Blockchain/Web3",
  "Health Tech",
  "FinTech",
  "Sustainability",
  "Hardware/IoT",
  "Gaming",
  "Open Innovation",
  "Social Good",
];

interface Progress {
  byJudge: { judgeUserId: string; judgeName: string; total: number; completed: number }[];
  bySubmission: { submissionId: string; assigned: number; completed: number }[];
  unassignedCount: number;
}

// Reported live ("nothing is shown on judging progress and per-submission
// coverage either"): Progress above reads judgeAssignments, which
// pairwise-mode events never populate, so both sections silently showed
// "No assignments yet" no matter how much real comparing had happened.
// One row per (judge, track) -- see PairwiseService.getProgressForOrganizer
// for why that's a better shape here than rubric mode's one-row-per-judge.
interface PairwiseProgressRow {
  judgeUserId: string;
  judgeName: string;
  trackId: string;
  trackName: string;
  completed: number;
  total: number;
}

interface CriterionDraft {
  name: string;
  weight: number;
}

// Shortcuts only, same pattern as SUGGESTED_TRACKS: weights sum to 1.0 if
// every suggestion is added together, but each is independently editable.
const SUGGESTED_CRITERIA: CriterionDraft[] = [
  { name: "Technical Execution", weight: 0.35 },
  { name: "Innovation", weight: 0.25 },
  { name: "Design/UX", weight: 0.15 },
  { name: "Impact", weight: 0.15 },
  { name: "Presentation", weight: 0.1 },
];

interface Criterion {
  id: string;
  name: string;
  weight: string;
}

interface Rubric {
  id: string;
  name: string;
  trackId: string | null;
  archived: boolean;
  criteria: Criterion[];
}

interface OutlierJudge {
  judgeUserId: string;
  judgeName: string;
  scoreCount: number;
  nearZeroVariance: boolean;
  tooFewScores: boolean;
  divergesFromPeers: boolean;
  correlationWithPeers: number | null;
}

// datetime-local reads/writes local time with no timezone info: convert
// the event's stored UTC ISO string to what the input expects to display.
function toLocalInputValue(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "setup", label: "Setup" },
  { id: "judges", label: "Judges" },
  { id: "results", label: "Results" },
  { id: "data", label: "Data" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const EXPORTABLE_RESOURCES = [
  "registrations",
  "teams",
  "submissions",
  "assignments",
  "scores",
  "normalized-results",
  "pairwise-rankings",
  "votes",
  "audit-log",
] as const;

// FR-BULK-01: mirrors CSV_IMPORT_SCHEMAS in apps/api/src/bulk/csv-import.service.ts.
const CSV_IMPORT_RESOURCES = [
  { value: "teams", label: "Teams", columns: "name, ownerEmail" },
  { value: "registrations", label: "Registrations", columns: "teamName, userEmail" },
  {
    value: "submissions",
    label: "Submissions",
    columns: "teamName, trackName, name, tagline, description, repoUrl, liveUrl, demoVideoUrl",
  },
] as const;
type CsvImportResource = (typeof CSV_IMPORT_RESOURCES)[number]["value"];

interface CsvImportReport {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{ row: number; status: "created" | "error"; message?: string }>;
}

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  actionLabel: string;
  resourceType: string;
  resourceId: string;
  resourceLabel: string;
  createdAt: string;
}

interface TeamForCert {
  id: string;
  name: string;
  members: { userId: string; userName: string }[];
}

interface GeneratedCertificate {
  id: string;
  type: string;
  recipientUserId: string;
  recipientLabel: string;
}

export default function OrganizerPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { ask, dialog } = useConfirm();
  const [tab, setTab] = useState<TabId>("overview");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [judges, setJudges] = useState<EventRoleListEntry[]>([]);
  const [organizers, setOrganizers] = useState<EventRoleListEntry[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [pairwiseProgress, setPairwiseProgress] = useState<PairwiseProgressRow[] | null>(null);
  const [unjudged, setUnjudged] = useState<{ id: string; name: string }[]>([]);
  const [voteTally, setVoteTally] = useState<
    { submissionId: string; totalVotes: number; voterCount: number }[]
  >([]);
  const [trackName, setTrackName] = useState("");
  const [prizeName, setPrizeName] = useState("");
  const [prizeTrackId, setPrizeTrackId] = useState("");
  const [prizeWinnerCount, setPrizeWinnerCount] = useState(1);
  const [judgeEmail, setJudgeEmail] = useState("");
  const [organizerEmail, setOrganizerEmail] = useState("");
  const [judgeTrackIds, setJudgeTrackIds] = useState<string[]>([]);
  const [selfJudgeTrackIds, setSelfJudgeTrackIds] = useState<string[]>([]);
  const [assignTrackId, setAssignTrackId] = useState("");
  const [minJudges, setMinJudges] = useState(2);
  const [manualTrackId, setManualTrackId] = useState("");
  const [manualSubmissions, setManualSubmissions] = useState<Submission[]>([]);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [selectedJudgeUserIds, setSelectedJudgeUserIds] = useState<string[]>([]);
  const [manualResult, setManualResult] = useState<{
    created: number;
    skipped: { submissionId: string; judgeUserId: string; reason: string }[];
  } | null>(null);
  const [outlierJudges, setOutlierJudges] = useState<(OutlierJudge & { rubricName: string })[]>([]);
  const [rubricName, setRubricName] = useState("Main Rubric");
  const [rubricTrackId, setRubricTrackId] = useState("");
  const [criteria, setCriteria] = useState<CriterionDraft[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const undoTimeoutRef = useRef<number | null>(null);

  function scheduleUndo(action: () => void) {
    if (undoTimeoutRef.current) {
      window.clearTimeout(undoTimeoutRef.current);
    }
    setUndoAction(() => action);
    undoTimeoutRef.current = window.setTimeout(() => setUndoAction(null), 10000);
  }

  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditVerify, setAuditVerify] = useState<{
    valid: boolean;
    brokenAt?: string;
    reason?: string;
  } | null>(null);
  const [teamsForEvent, setTeamsForEvent] = useState<TeamForCert[]>([]);
  const [certType, setCertType] = useState<"participation" | "winner" | "judge">("participation");
  const [certRecipients, setCertRecipients] = useState<string[]>([]);
  const [generatedCertificates, setGeneratedCertificates] = useState<GeneratedCertificate[]>([]);
  const [csvImportResource, setCsvImportResource] = useState<CsvImportResource>("teams");
  const [csvImportReport, setCsvImportReport] = useState<CsvImportReport | null>(null);
  const [widgetTrackId, setWidgetTrackId] = useState("");
  const [widgetLimit, setWidgetLimit] = useState(12);
  const [widgetTheme, setWidgetTheme] = useState<"light" | "dark">("light");

  const loadAuditLog = () => {
    api
      .get<{ items: AuditEntry[] }>(`/events/${eventId}/audit-log`)
      .then((r) => setAuditEntries(r.items))
      .catch(() => {});
    api
      .get<{ valid: boolean; brokenAt?: string; reason?: string }>(
        `/events/${eventId}/audit-log/verify`,
      )
      .then(setAuditVerify)
      .catch(() => {});
  };
  const loadTeamsForEvent = () =>
    api
      .get<TeamForCert[]>(`/events/${eventId}/teams`)
      .then(setTeamsForEvent)
      .catch(() => {});

  const loadTracks = () =>
    api
      .get<Track[]>(`/events/${eventId}/tracks`)
      .then(setTracks)
      .catch(() => {});
  const loadPrizes = () =>
    api
      .get<Prize[]>(`/events/${eventId}/prizes`)
      .then(setPrizes)
      .catch(() => {});
  const loadJudges = () =>
    api
      .get<EventRoleListEntry[]>(`/events/${eventId}/judges`)
      .then(setJudges)
      .catch(() => {});
  const loadOrganizers = () =>
    api
      .get<EventRoleListEntry[]>(`/events/${eventId}/organizers`)
      .then(setOrganizers)
      .catch(() => {});
  const loadRubrics = () =>
    api
      .get<Rubric[]>(`/events/${eventId}/judging/rubrics?includeArchived=true`)
      .then(setRubrics)
      .catch(() => {});
  // FR-NORM-04 checks one rubric's scores at a time on the backend, so this
  // fans out across every active rubric and tags each flagged judge with
  // which rubric flagged them.
  const loadOutlierJudges = (rubricList: Rubric[]) => {
    const active = rubricList.filter((r) => !r.archived);
    Promise.all(
      active.map((r) =>
        api
          .get<OutlierJudge[]>(`/events/${eventId}/judging/results/outlier-judges?rubricId=${r.id}`)
          .then((rows) => rows.map((row) => ({ ...row, rubricName: r.name })))
          .catch(() => []),
      ),
    ).then((byRubric) => setOutlierJudges(byRubric.flat()));
  };
  const loadProgress = () =>
    api
      .get<Progress>(`/events/${eventId}/judging/progress`)
      .then(setProgress)
      .catch(() => {});
  const loadPairwiseProgress = () =>
    api
      .get<PairwiseProgressRow[]>(`/events/${eventId}/pairwise/organizer-progress`)
      .then(setPairwiseProgress)
      .catch(() => {});
  const loadUnjudged = () =>
    api
      .get<{ id: string; name: string }[]>(`/events/${eventId}/results/unjudged`)
      .then(setUnjudged)
      .catch(() => {});
  // Reported live: organizers had no discoverable way to check the vote
  // tally before publishing, even though the backend has always let
  // organizers through here pre-publish (FR-RESULT-02 only hides it from
  // everyone else). The only path was the separate "View results" page,
  // buried below rubric/pairwise sections; this surfaces it directly in
  // the dashboard instead.
  const loadVoteTally = () =>
    api
      .get<{ submissionId: string; totalVotes: number; voterCount: number }[]>(
        `/events/${eventId}/votes/tally`,
      )
      .then(setVoteTally)
      .catch(() => {});
  const loadEvent = () =>
    api
      .get<Event>(`/events/${eventId}`)
      .then(setEvent)
      .catch(() => {});
  // Gallery, not a dedicated submissions-listing endpoint: organizers get
  // full access (including a hidden gallery) via the same isEventOrganizer
  // bypass the public gallery view uses, and it's already filtered to
  // submitted (assignable) entries.
  const loadManualSubmissions = () =>
    api
      .get<{ items: Submission[] }>(`/events/${eventId}/gallery?limit=200`)
      .then((r) => setManualSubmissions(r.items))
      .catch(() => {});

  useEffect(() => {
    loadTracks();
    loadPrizes();
    loadJudges();
    loadOrganizers();
    loadRubrics();
    loadProgress();
    loadPairwiseProgress();
    loadUnjudged();
    loadEvent();
    loadManualSubmissions();
    loadAuditLog();
    loadTeamsForEvent();
    loadVoteTally();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Re-derives outlier flags when the rubric list changes. Scores change
  // via the judge scoring pages, not this dashboard, so this doesn't need
  // its own poll: reopening the Results tab picks up new scores.
  useEffect(() => {
    loadOutlierJudges(rubrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubrics]);

  // FR-DASH-01's "near-real-time" progress: a judge scoring in another tab
  // never touches this page, so without a poll the organizer would only
  // see stale counts. unjudged and voteTally ride the same poll for the
  // same reason (votes come in from anonymous browsers this dashboard
  // never hears about otherwise).
  useEffect(() => {
    const id = setInterval(() => {
      loadProgress();
      loadPairwiseProgress();
      loadUnjudged();
      loadVoteTally();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setError(null);
    setStatus(null);
    if (undoTimeoutRef.current) {
      window.clearTimeout(undoTimeoutRef.current);
    }
    setUndoAction(null);
    try {
      await action();
      setStatus(successMessage);
      loadTracks();
      loadPrizes();
      loadJudges();
      loadOrganizers();
      loadRubrics();
      loadProgress();
      loadPairwiseProgress();
      loadUnjudged();
      loadEvent();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
      return false;
    }
  }

  // Separate from run(): needs to inspect the response body (created count,
  // skipped reasons), not just show a generic success message. A skipped
  // conflict-of-interest pairing can be force-assigned by calling this
  // again with force: true; a skipped track-scoping pairing can't.
  async function submitManualAssignment(
    submissionIds: string[],
    judgeUserIds: string[],
    force: boolean,
  ) {
    setError(null);
    setStatus(null);
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
      loadProgress();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to assign");
    }
  }

  // Previously had no gate of its own: it just rendered and let each API
  // call fail individually, so a non-organizing admin navigating here
  // directly saw a dashboard full of failed requests. isAdmin deliberately
  // doesn't satisfy this, matching is-event-organizer.ts on the backend,
  // which every one of this page's API calls is actually gated by.
  const isOrganizer = !!user?.eventRoles.some(
    (r) => r.eventId === eventId && r.role === EVENT_ROLE.ORGANIZER,
  );
  if (authLoading) {
    return <LoadingState />;
  }
  if (!isOrganizer) {
    return (
      <div className="max-w-md">
        <h1 className="text-h1 font-semibold text-ink">Organizer dashboard</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {user
            ? "You don't have organizer access to this event. Only its actual organizer(s) can view this dashboard."
            : "Sign in as this event's organizer to view its dashboard."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {dialog}
      <div>
        <h1 className="text-h1 font-semibold text-ink">Organizer dashboard</h1>
        {error && (
          <p data-testid="dashboard-error" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        {status && (
          <p data-testid="dashboard-status" className="mt-2 text-sm text-success">
            {status}
            {undoAction && (
              <button
                type="button"
                data-testid="dashboard-undo"
                onClick={() => {
                  undoAction();
                  setUndoAction(null);
                }}
                className="ml-2 underline hover:no-underline"
              >
                Undo
              </button>
            )}
          </p>
        )}
      </div>

      <div className="flex gap-1 border-b border-line" data-testid="dashboard-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`tab-${t.id}`}
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

      {tab === "overview" && (
        <>
          <section>
            <h2 className="text-h2 font-semibold text-ink">Event settings</h2>
            <p className="mt-1 text-xs leading-normal text-muted">
              A new event starts as a hidden draft. Move it to a later status (and open the gallery
              / enable voting) once you&rsquo;re ready for participants and visitors to see it.
            </p>
            {!event ? (
              <LoadingState className="mt-2" />
            ) : (
              <>
                <div className="mt-3 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-medium tracking-wide text-muted">
                      Status
                    </label>
                    {event.registrationOpenAt !== null ? (
                      // Automatic mode — status tracks the configured dates
                      // on its own (see the StatusBadge below), including
                      // going public on its own once registrationOpenAt
                      // passes (isEventVisible on the backend); no "make
                      // public" button here anymore. Archiving is the one
                      // thing that still needs an explicit organizer
                      // action, since that's never implied by a clock alone
                      // in either mode.
                      <div className="mt-1">
                        <StatusBadge status={event.displayStatus} />
                        {event.status === EVENT_STATUS.RESULTS_PUBLISHED ? (
                          <button
                            data-testid="event-archive"
                            onClick={() =>
                              run(
                                () =>
                                  api.patch(`/events/${eventId}`, {
                                    status: EVENT_STATUS.ARCHIVED,
                                  }),
                                "Event archived.",
                              )
                            }
                            className="mt-1.5 block rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-alt"
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      // Manual mode — status is the organizer's own call,
                      // but only one step forward at a time (backend now
                      // rejects any forward jump that isn't the immediate
                      // next status — requested explicitly, after finding
                      // this dropdown let an organizer skip straight from
                      // draft to judging). Moving backward stays offered
                      // among the four regular statuses (still guarded
                      // server-side, unchanged) — this only trims how far
                      // *forward* the list reaches. results_published can't
                      // be selected here either way (Publish results button
                      // on the Results tab only); "archived" is offered
                      // only once results have actually been published,
                      // its one real precondition.
                      <select
                        data-testid="event-status-select"
                        value={event.status}
                        onChange={(e) =>
                          run(
                            () => api.patch(`/events/${eventId}`, { status: e.target.value }),
                            `Event status set to "${e.target.value}".`,
                          )
                        }
                        className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                      >
                        {event.status === EVENT_STATUS.RESULTS_PUBLISHED ? (
                          <>
                            <option value={EVENT_STATUS.RESULTS_PUBLISHED}>
                              results published
                            </option>
                            <option value={EVENT_STATUS.ARCHIVED}>archived</option>
                          </>
                        ) : event.status === EVENT_STATUS.ARCHIVED ? (
                          <option value={EVENT_STATUS.ARCHIVED}>archived</option>
                        ) : (
                          REGULAR_MANUAL_STATUSES.slice(
                            0,
                            REGULAR_MANUAL_STATUSES.indexOf(
                              event.status as (typeof REGULAR_MANUAL_STATUSES)[number],
                            ) + 2,
                          ).map((s) => (
                            <option key={s} value={s}>
                              {s.replace("_", " ")}
                            </option>
                          ))
                        )}
                      </select>
                    )}
                  </div>
                  <div>
                    <EventSettingSelect
                      label="Scoring mode"
                      testId="event-scoring-select"
                      eventId={eventId}
                      field="scoringMode"
                      value={event.scoringMode}
                      options={SCORING_MODES}
                      run={run}
                    />
                  </div>
                  <div>
                    <EventSettingSelect
                      label="Gallery visibility"
                      testId="event-gallery-select"
                      eventId={eventId}
                      field="galleryVisibility"
                      value={event.galleryVisibility}
                      options={GALLERY_VISIBILITIES}
                      run={run}
                    />
                  </div>
                  <div>
                    <EventSettingSelect
                      label="Voting mode"
                      testId="event-voting-select"
                      eventId={eventId}
                      field="votingMode"
                      value={event.votingMode}
                      options={VOTING_MODES}
                      run={run}
                    />
                  </div>
                  <div>
                    <EventSettingSelect
                      label="Voting access"
                      testId="event-voting-access-select"
                      eventId={eventId}
                      field="votingAccess"
                      value={event.votingAccess}
                      options={VOTING_ACCESS_LEVELS}
                      run={run}
                    />
                  </div>
                </div>

                {event.registrationOpenAt !== null ? (
                  <div className="mt-4 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
                    {(
                      [
                        ["registrationOpenAt", "Registration opens", null],
                        ["registrationCloseAt", "Registration closes", "registrationOpenAt"],
                        ["submissionOpenAt", "Submissions open", "registrationCloseAt"],
                        ["submissionCloseAt", "Submission deadline", "submissionOpenAt"],
                        ["judgingOpenAt", "Judging opens", "submissionCloseAt"],
                        ["judgingCloseAt", "Judging closes", "judgingOpenAt"],
                      ] as const
                    ).map(([field, label, prevField]) => {
                      // Found live: every date was freely editable at any
                      // time, including rewriting registrationOpenAt after
                      // registration had already begun, and — separately —
                      // setting a field before the one right before it in
                      // the sequence (submissionOpenAt before
                      // registrationCloseAt, say), which the backend didn't
                      // even reject in that particular case. The backend
                      // now rejects both (LIFECYCLE_DATE_LOCKED,
                      // VALIDATION_ERROR) — both mirrored here so the field
                      // can't be set to an invalid value in the first
                      // place, rather than letting the organizer fill it in
                      // and only then see the PATCH fail.
                      const value = event[field];
                      const isPast = value !== null && new Date(value) <= new Date();
                      const min = prevField ? event[prevField] : null;
                      return (
                        <div key={field}>
                          <label className="block text-xs font-medium tracking-wide text-muted">
                            {label}
                            {isPast && (
                              <span className="ml-1 font-normal text-muted">(passed)</span>
                            )}
                          </label>
                          <input
                            type="datetime-local"
                            data-testid={`event-${field}`}
                            defaultValue={toLocalInputValue(value)}
                            disabled={isPast}
                            min={min ? toLocalInputValue(min) : undefined}
                            title={isPast ? "Already passed, can no longer be changed" : undefined}
                            onBlur={(e) => {
                              const raw = e.target.value;
                              if (!raw) {
                                return;
                              }
                              if (min && new Date(raw) < new Date(min)) {
                                setError(
                                  `${label} can't be before ${toLocalInputValue(min).replace("T", " ")}.`,
                                );
                                e.target.value = toLocalInputValue(value);
                                return;
                              }
                              run(
                                () =>
                                  api.patch(`/events/${eventId}`, {
                                    [field]: new Date(raw).toISOString(),
                                  }),
                                `${label} updated.`,
                              );
                            }}
                            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-line/30 disabled:text-muted"
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-4 max-w-2xl">
                  <label className="block text-xs font-medium tracking-wide text-muted">
                    Banner image URL
                  </label>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Shown at the top of the event page and on its card in the events list and
                    homepage. Leave blank for an auto-generated default banner. Same posture as a
                    submission&rsquo;s thumbnail image: a URL you supply, not a file upload.
                  </p>
                  <input
                    type="url"
                    placeholder="https://…"
                    data-testid="event-banner-url"
                    defaultValue={event.bannerImageUrl ?? ""}
                    onBlur={(e) =>
                      run(
                        () =>
                          api.patch(`/events/${eventId}`, {
                            bannerImageUrl: e.target.value || null,
                          }),
                        "Banner image updated.",
                      )
                    }
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Judging progress</h2>
            {event?.scoringMode === SCORING_MODE.PAIRWISE ? (
              // Reported live ("nothing is shown on judging progress...
              // either"): this used to just fall through to the rubric
              // table below, which reads judgeAssignments -- a table
              // pairwise mode never writes to at all -- so it silently
              // showed "No assignments yet" no matter how much real
              // comparing had happened. One row per (judge, track): a
              // judge's coverage is inherently track-scoped here, so
              // collapsing two tracks into one total the way rubric mode
              // does would hide which specific track still needs
              // attention.
              <>
                {!pairwiseProgress ? (
                  <LoadingState className="mt-2" />
                ) : pairwiseProgress.length === 0 ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    No judges scoped to a track yet.
                  </p>
                ) : (
                  <table
                    data-testid="pairwise-progress-by-judge"
                    className="mt-3 w-full max-w-lg text-sm"
                  >
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="pb-1">Judge</th>
                        <th className="pb-1">Track</th>
                        <th className="pb-1">Compared</th>
                        <th className="pb-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairwiseProgress.map((row) => {
                        const label =
                          row.completed === 0
                            ? "Not started"
                            : row.completed >= row.total
                              ? "Done"
                              : "In progress";
                        const badgeClass =
                          row.completed === 0
                            ? "bg-danger-soft text-danger"
                            : row.completed >= row.total
                              ? "bg-success-soft text-success"
                              : "bg-accent-soft text-accent-dark";
                        return (
                          <tr
                            key={`${row.judgeUserId}-${row.trackId}`}
                            className="border-t border-line"
                          >
                            <td className="py-1">
                              <span className="flex items-center gap-2">
                                <Avatar name={row.judgeName} size={20} />
                                {row.judgeName}
                              </span>
                            </td>
                            <td className="py-1">{row.trackName}</td>
                            <td className="py-1">
                              {row.completed} / {row.total}
                            </td>
                            <td className="py-1">
                              <span
                                data-testid={`pairwise-judge-status-${row.judgeUserId}-${row.trackId}`}
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                              >
                                {label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </>
            ) : !progress ? (
              <LoadingState className="mt-2" />
            ) : progress.byJudge.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">No assignments yet.</p>
            ) : (
              <table data-testid="progress-by-judge" className="mt-3 w-full max-w-lg text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pb-1">Judge</th>
                    <th className="pb-1">Completed</th>
                    <th className="pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.byJudge.map((j) => {
                    const label =
                      j.completed === 0
                        ? "Not started"
                        : j.completed === j.total
                          ? "Done"
                          : "In progress";
                    const badgeClass =
                      j.completed === 0
                        ? "bg-danger-soft text-danger"
                        : j.completed === j.total
                          ? "bg-success-soft text-success"
                          : "bg-accent-soft text-accent-dark";
                    return (
                      <tr key={j.judgeUserId} className="border-t border-line">
                        <td className="py-1">
                          <span className="flex items-center gap-2">
                            <Avatar name={j.judgeName} size={20} />
                            {j.judgeName}
                          </span>
                        </td>
                        <td className="py-1">
                          {j.completed} / {j.total}
                        </td>
                        <td className="py-1">
                          <span
                            data-testid={`judge-status-${j.judgeUserId}`}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}
                          >
                            {label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Per-submission coverage</h2>
            {event?.scoringMode === SCORING_MODE.PAIRWISE ? (
              // Requested explicitly, once it was clear per-submission
              // coverage doesn't translate cleanly to pairwise mode: a
              // submission's "coverage" there isn't a single number the
              // way rubric mode's assigned/completed count is -- it's how
              // many of its pairs each individual judge has compared,
              // which the Judging progress table above already shows from
              // the judge's side. Saying so explicitly instead of showing
              // an empty table or forcing a number that wouldn't mean
              // what it looks like it means.
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Per-submission coverage isn&rsquo;t tracked the same way in pairwise mode -- see
                Judging progress above for each judge&rsquo;s comparison coverage per track.
              </p>
            ) : !progress ? (
              <LoadingState className="mt-2" />
            ) : progress.bySubmission.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">No assignments yet.</p>
            ) : (
              <table data-testid="progress-by-submission" className="mt-3 w-full max-w-lg text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pb-1">Submission</th>
                    <th className="pb-1">Judged</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.bySubmission.map((s) => {
                    const name =
                      manualSubmissions.find((sub) => sub.id === s.submissionId)?.name ??
                      s.submissionId;
                    return (
                      <tr key={s.submissionId} className="border-t border-line">
                        <td className="py-1">{name}</td>
                        <td className="py-1">
                          {s.completed} / {s.assigned}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {tab === "setup" && (
        <section>
          <div>
            <h2 className="text-h2 font-semibold text-ink">Add a track</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () => api.post(`/events/${eventId}/tracks`, { name: trackName }),
                  `Track "${trackName}" created.`,
                ).then(() => setTrackName(""));
              }}
              className="mt-3 flex gap-2"
            >
              <input
                required
                placeholder="Track name"
                data-testid="track-name"
                value={trackName}
                onChange={(e) => setTrackName(e.target.value)}
                className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
              />
              <button
                type="submit"
                data-testid="track-add-submit"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
              >
                Add
              </button>
            </form>

            {SUGGESTED_TRACKS.some((s) => !tracks.some((t) => t.name === s)) && (
              <div className="mt-3">
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_TRACKS.filter((s) => !tracks.some((t) => t.name === s)).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        run(
                          () => api.post(`/events/${eventId}/tracks`, { name: s }),
                          `Track "${s}" created.`,
                        )
                      }
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ul data-testid="track-list" className="mt-3 space-y-1 text-sm text-muted">
              {tracks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <span>{t.name}</span>
                  <button
                    type="button"
                    data-testid={`track-remove-${t.id}`}
                    onClick={() => {
                      ask(`Remove track "${t.name}"?`, () => {
                        run(
                          () => api.delete(`/events/${eventId}/tracks/${t.id}`),
                          `Track "${t.name}" removed.`,
                        ).then((ok) => {
                          if (ok) {
                            scheduleUndo(() => {
                              api
                                .post(`/events/${eventId}/tracks`, { name: t.name })
                                .then(() => {
                                  setStatus(`Track "${t.name}" restored.`);
                                  loadTracks();
                                })
                                .catch((err) =>
                                  setError(
                                    err instanceof ApiError ? err.message : "Failed to restore",
                                  ),
                                );
                            });
                          }
                        });
                      });
                    }}
                    className="rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:bg-surface-alt"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "setup" && (
        <section>
          <h2 className="text-h2 font-semibold text-ink">Co-organizers</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            A co-organizer has the same power over this event as you do, including inviting further
            co-organizers. They can decline from notifications.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => api.post(`/events/${eventId}/organizers`, { email: organizerEmail }),
                "Co-organizer invited.",
              ).then((ok) => {
                if (ok) {
                  setOrganizerEmail("");
                }
              });
            }}
            className="mt-3 flex gap-2"
          >
            <input
              required
              type="email"
              data-testid="organizer-email"
              value={organizerEmail}
              onChange={(e) => setOrganizerEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
            />
            <button
              type="submit"
              data-testid="organizer-invite-submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Invite
            </button>
          </form>
          <ul data-testid="organizer-list" className="mt-3 space-y-1 text-sm text-muted">
            {organizers.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span>
                  {o.name} ({o.email})
                </span>
                {o.status !== INVITE_STATUS.ACCEPTED && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      o.status === INVITE_STATUS.PENDING
                        ? "bg-accent-soft text-accent-dark"
                        : "bg-surface-alt text-muted"
                    }`}
                  >
                    {o.status === INVITE_STATUS.PENDING ? "Invited, awaiting response" : "Declined"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "judges" && (
        <section>
          {!judges.some((j) => j.userId === user?.id && j.status === INVITE_STATUS.ACCEPTED) && (
            <div className="mb-6 rounded-lg border border-line bg-surface-alt p-3">
              <p className="text-sm font-medium text-ink">Judge this event yourself</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {tracks.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={selfJudgeTrackIds.includes(t.id)}
                      onChange={(e) =>
                        setSelfJudgeTrackIds((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              <button
                type="button"
                data-testid="judge-self"
                disabled={selfJudgeTrackIds.length === 0}
                onClick={() => {
                  run(
                    () =>
                      api.post(`/events/${eventId}/judges/self`, { trackIds: selfJudgeTrackIds }),
                    "You're now judging this event.",
                  ).then((ok) => {
                    if (ok) {
                      setSelfJudgeTrackIds([]);
                      loadJudges();
                    }
                  });
                }}
                className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start judging
              </button>
            </div>
          )}
          <div>
            <h2 className="text-h2 font-semibold text-ink">Invite a judge</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  () =>
                    api.post(`/events/${eventId}/judges`, {
                      email: judgeEmail,
                      trackIds: judgeTrackIds,
                    }),
                  `Invited ${judgeEmail}.`,
                );
                setJudgeTrackIds([]);
              }}
              className="mt-3 space-y-2"
            >
              <input
                required
                type="email"
                placeholder="Judge's email (must already have an account)"
                data-testid="judge-email"
                value={judgeEmail}
                onChange={(e) => setJudgeEmail(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <div>
                <p className="text-xs leading-normal text-muted">
                  Scope to track{tracks.length > 1 ? "s" : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="judge-track-checkboxes">
                  {tracks.map((t) => {
                    const checked = judgeTrackIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
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
                            setJudgeTrackIds((prev) =>
                              checked ? prev.filter((id) => id !== t.id) : [...prev, t.id],
                            )
                          }
                        />
                        {t.name}
                      </label>
                    );
                  })}
                </div>
                {tracks.length === 0 && (
                  <p className="mt-1 text-xs leading-normal text-muted">Add a track first.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={judgeTrackIds.length === 0}
                data-testid="judge-invite-submit"
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
              >
                Invite
              </button>
            </form>

            <ul data-testid="judge-list" className="mt-3 space-y-1 text-sm text-muted">
              {judges.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-2">
                  <span>
                    {j.name} ({j.email})
                    {j.tracks.length > 0 ? ` on ${j.tracks.map((t) => t.name).join(", ")}` : ""}
                    {j.status !== INVITE_STATUS.ACCEPTED && (
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                          j.status === INVITE_STATUS.PENDING
                            ? "bg-accent-soft text-accent-dark"
                            : "bg-surface-alt text-muted"
                        }`}
                      >
                        {j.status === INVITE_STATUS.PENDING
                          ? "Invited, awaiting response"
                          : "Declined"}
                      </span>
                    )}
                  </span>
                  {j.status === INVITE_STATUS.ACCEPTED && (
                    <button
                      type="button"
                      data-testid={`judge-remove-${j.id}`}
                      onClick={() => {
                        ask(
                          `Remove ${j.name} as a judge? Any of their in-progress or submitted scores will be permanently deleted.`,
                          () => {
                            run(
                              () => api.delete(`/events/${eventId}/judges/${j.id}`),
                              `${j.name} removed.`,
                            ).then((ok) => {
                              if (ok) {
                                scheduleUndo(() => {
                                  api
                                    .post(`/events/${eventId}/judges`, {
                                      email: j.email,
                                      trackIds: j.tracks.map((t) => t.id),
                                    })
                                    .then(() => {
                                      setStatus(
                                        `${j.name} re-invited. They'll need to accept again. (Any deleted scores are not restored.)`,
                                      );
                                      loadJudges();
                                    })
                                    .catch((err) =>
                                      setError(
                                        err instanceof ApiError ? err.message : "Failed to restore",
                                      ),
                                    );
                                });
                              }
                            });
                          },
                        );
                      }}
                      className="rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:bg-surface-alt"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "setup" && (
        <section>
          <h2 className="text-h2 font-semibold text-ink">Prizes</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  api.post(`/events/${eventId}/prizes`, {
                    name: prizeName,
                    trackId: prizeTrackId || null,
                    winnerCount: prizeWinnerCount,
                  }),
                `Prize "${prizeName}" added.`,
              ).then((ok) => {
                if (ok) {
                  loadPrizes();
                }
              });
              setPrizeName("");
              setPrizeWinnerCount(1);
            }}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-medium tracking-wide text-muted">
                Prize name
              </label>
              <input
                required
                placeholder="e.g. Best AI/ML Hack"
                data-testid="prize-name"
                value={prizeName}
                onChange={(e) => setPrizeName(e.target.value)}
                className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-muted">Track</label>
              <select
                data-testid="prize-track-select"
                value={prizeTrackId}
                onChange={(e) => setPrizeTrackId(e.target.value)}
                className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
              >
                <option value="">Overall (event-wide)</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-muted">Winners</label>
              {/* Requested explicitly: the system silently assumed exactly
                  one winner per prize. Defaults to 1 (that same prior
                  behavior) but an organizer can set e.g. 3 for "top 3 in
                  AI/ML" or "top 3 overall" (single-track events, Track
                  left as Overall). */}
              <input
                required
                type="number"
                min={1}
                step={1}
                data-testid="prize-winner-count"
                value={prizeWinnerCount}
                onChange={(e) => setPrizeWinnerCount(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 w-20 rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              data-testid="prize-add-submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Add
            </button>
          </form>
          <ul data-testid="prize-list" className="mt-3 space-y-2 text-sm text-muted">
            {prizes.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  {p.name}
                  {p.trackId
                    ? ` (${tracks.find((t) => t.id === p.trackId)?.name ?? "track"})`
                    : " (overall)"}
                </span>
                <span className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    Winners
                    <input
                      type="number"
                      min={1}
                      step={1}
                      data-testid={`prize-winner-count-${p.id}`}
                      defaultValue={p.winnerCount}
                      onBlur={(e) => {
                        const value = Math.max(1, Number(e.target.value) || 1);
                        if (value === p.winnerCount) {
                          return;
                        }
                        run(
                          () =>
                            api.patch(`/events/${eventId}/prizes/${p.id}`, {
                              winnerCount: value,
                            }),
                          `"${p.name}" now has ${value} winner${value === 1 ? "" : "s"}.`,
                        ).then((ok) => {
                          if (ok) {
                            loadPrizes();
                          } else {
                            e.target.value = String(p.winnerCount);
                          }
                        });
                      }}
                      className="w-14 rounded-md border border-line px-2 py-1 text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    data-testid={`prize-remove-${p.id}`}
                    onClick={() => {
                      ask(`Remove prize "${p.name}"?`, () => {
                        run(
                          () => api.delete(`/events/${eventId}/prizes/${p.id}`),
                          `Prize "${p.name}" removed.`,
                        ).then((ok) => {
                          if (ok) {
                            loadPrizes();
                            scheduleUndo(() => {
                              api
                                .post(`/events/${eventId}/prizes`, {
                                  name: p.name,
                                  trackId: p.trackId,
                                  winnerCount: p.winnerCount,
                                })
                                .then(() => {
                                  setStatus(`Prize "${p.name}" restored.`);
                                  loadPrizes();
                                })
                                .catch((err) =>
                                  setError(
                                    err instanceof ApiError ? err.message : "Failed to restore",
                                  ),
                                );
                            });
                          }
                        });
                      });
                    }}
                    className="rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:bg-surface-alt"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "setup" && (
        <section>
          <h2 className="text-h2 font-semibold text-ink">Create a rubric</h2>
          <p className="mt-1 text-xs leading-normal text-muted">
            Criterion weights must sum to 1.0. Leave track blank for an event-wide rubric.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  api.post(`/events/${eventId}/judging/rubrics`, {
                    name: rubricName,
                    trackId: rubricTrackId || null,
                    criteria: criteria.map((c) => ({
                      name: c.name,
                      description: "",
                      weight: c.weight,
                    })),
                  }),
                `Rubric "${rubricName}" created.`,
              );
            }}
            className="mt-3 max-w-lg space-y-3"
          >
            <input
              required
              placeholder="Rubric name"
              data-testid="rubric-name"
              value={rubricName}
              onChange={(e) => setRubricName(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
            />
            <select
              data-testid="rubric-track-select"
              value={rubricTrackId}
              onChange={(e) => setRubricTrackId(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm"
            >
              <option value="">All tracks (event-wide)</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            {SUGGESTED_CRITERIA.some((s) => !criteria.some((c) => c.name === s.name)) && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_CRITERIA.filter((s) => !criteria.some((c) => c.name === s.name)).map(
                  (s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => setCriteria([...criteria, { ...s }])}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
                    >
                      + {s.name}
                    </button>
                  ),
                )}
              </div>
            )}

            {criteria.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  required
                  placeholder="Criterion name"
                  data-testid={`rubric-criterion-name-${i}`}
                  value={c.name}
                  onChange={(e) => {
                    const next = [...criteria];
                    next[i] = { ...next[i], name: e.target.value };
                    setCriteria(next);
                  }}
                  className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
                />
                <input
                  required
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  data-testid={`rubric-criterion-weight-${i}`}
                  value={c.weight}
                  onChange={(e) => {
                    // Clamped here, not just constrained by the backend: a
                    // weight above 1 or below 0 is nonsensical (a criterion
                    // worth more than the whole rubric, or a negative
                    // weight), so it's corrected the moment it's typed
                    // rather than left to round-trip to the API and back
                    // as an error. The API still enforces the same bound
                    // independently — see RubricCriterionInput — since a
                    // request can always be sent directly, bypassing this
                    // form entirely.
                    const raw = Number(e.target.value);
                    const clamped = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
                    const next = [...criteria];
                    next[i] = { ...next[i], weight: clamped };
                    setCriteria(next);
                  }}
                  className="w-24 rounded-md border border-line px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                  className="rounded-md border border-line bg-paper px-2 text-sm text-muted hover:bg-surface-alt"
                >
                  ✕
                </button>
              </div>
            ))}
            {(() => {
              const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
              const weightValid = Math.abs(totalWeight - 1) < 0.001;
              const namesValid =
                criteria.length > 0 && criteria.every((c) => c.name.trim().length > 0);
              return (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => setCriteria([...criteria, { name: "", weight: 0 }])}
                      className="text-accent hover:underline"
                    >
                      + Add criterion
                    </button>
                    <span className={weightValid ? "text-success" : "text-danger"}>
                      Total weight: {totalWeight.toFixed(2)} (must be 1.00)
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={!weightValid || !namesValid}
                    data-testid="rubric-create-submit"
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
                  >
                    Create rubric
                  </button>
                </>
              );
            })()}
          </form>

          <ul data-testid="rubric-list" className="mt-4 max-w-lg space-y-3 text-sm">
            {rubrics.map((r) => (
              <li
                key={r.id}
                className={`rounded-md border border-line bg-surface p-3 ${r.archived ? "opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">
                    {r.name}
                    {r.trackId
                      ? ` (${tracks.find((t) => t.id === r.trackId)?.name ?? "track"})`
                      : " (event-wide)"}
                    {r.archived ? " (archived)" : ""}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      data-testid={`rubric-archive-${r.id}`}
                      onClick={() =>
                        run(
                          () =>
                            api.post(
                              `/events/${eventId}/judging/rubrics/${r.id}/${r.archived ? "unarchive" : "archive"}`,
                            ),
                          `Rubric "${r.name}" ${r.archived ? "unarchived" : "archived"}.`,
                        )
                      }
                      className="rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:bg-surface-alt"
                    >
                      {r.archived ? "Unarchive" : "Archive"}
                    </button>
                    <button
                      type="button"
                      data-testid={`rubric-remove-${r.id}`}
                      onClick={() => {
                        ask(`Remove rubric "${r.name}"?`, () => {
                          run(
                            () => api.delete(`/events/${eventId}/judging/rubrics/${r.id}`),
                            `Rubric "${r.name}" removed.`,
                          );
                        });
                      }}
                      className="rounded-md border border-line bg-paper px-2 text-xs font-medium text-muted hover:bg-surface-alt"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {r.criteria.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span>
                        {c.name} (weight {Number(c.weight).toFixed(2)})
                      </span>
                      <button
                        type="button"
                        data-testid={`rubric-criterion-remove-${c.id}`}
                        onClick={() =>
                          run(
                            () =>
                              api.delete(
                                `/events/${eventId}/judging/rubrics/${r.id}/criteria/${c.id}`,
                              ),
                            `Criterion "${c.name}" removed.`,
                          )
                        }
                        className="rounded-md border border-line bg-paper px-1.5 text-xs text-muted hover:bg-surface-alt"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "judges" && (
        <section>
          <h2 className="text-h2 font-semibold text-ink">Assign judges (algorithmic)</h2>
          {progress && progress.unassignedCount > 0 && (
            <p
              data-testid="unassigned-nudge"
              className="mt-1 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink"
            >
              {progress.unassignedCount} submitted{" "}
              {progress.unassignedCount === 1 ? "entry isn't" : "entries aren't"} assigned to a
              judge yet. Run Assign to include {progress.unassignedCount === 1 ? "it" : "them"}.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  api.post(`/events/${eventId}/judging/assignments`, {
                    strategy: "algorithmic",
                    trackId: assignTrackId,
                    minJudgesPerSubmission: minJudges,
                  }),
                "Assignments created.",
              );
            }}
            className="mt-3 flex flex-wrap items-end gap-3"
          >
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
              data-testid="assign-submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
            >
              Assign
            </button>
          </form>
        </section>
      )}

      {tab === "judges" && (
        <section>
          <h2 className="text-h2 font-semibold text-ink">Assign judges (manual)</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Pick specific submissions and judges to pair directly. A judge not scoped to a
            submission&rsquo;s track is always skipped; a declared conflict of interest (a shared
            workplace with a team member) is skipped by default but can be forced through
            individually below.
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
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Submissions
              </h3>
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
                  .filter((j) => j.status === INVITE_STATUS.ACCEPTED)
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
                  .filter((j) => j.status === INVITE_STATUS.ACCEPTED)
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
        </section>
      )}

      {tab === "results" && (
        <>
          <section>
            <h2 className="text-h2 font-semibold text-ink">Results</h2>
            {unjudged.length > 0 && (
              <div
                data-testid="unjudged-warning"
                className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm leading-relaxed text-ink"
              >
                {unjudged.length} submitted project{unjudged.length === 1 ? " hasn't" : "s haven't"}{" "}
                been judged yet, publishing is blocked until every submission has at least one
                completed score or comparison.
                <ul className="mt-1.5 list-inside list-disc">
                  {unjudged.map((s) => (
                    <li key={s.id}>{s.name}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 flex gap-3">
              <button
                data-testid="publish-results"
                disabled={unjudged.length > 0}
                onClick={() =>
                  run(() => api.post(`/events/${eventId}/results/publish`), "Results published.")
                }
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish results
              </button>
              <a
                href={`/events/${eventId}/results`}
                data-testid="view-results-link"
                className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt"
              >
                View results
              </a>
            </div>
            <p className="mt-2 text-xs text-muted">
              Scores and vote tallies stay hidden from everyone but organizers until &ldquo;Publish
              results&rdquo; is clicked.
            </p>
          </section>

          {event && event.votingMode !== VOTING_MODE.DISABLED && (
            <section>
              <h2 className="text-h2 font-semibold text-ink">Vote tally</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Visible to organizers only, before or after publish (FR-RESULT-02). Refreshes
                automatically every 30 seconds.
              </p>
              {voteTally.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No votes cast yet.</p>
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
                    {[...voteTally]
                      .sort((a, b) => b.totalVotes - a.totalVotes)
                      .map((row) => (
                        <tr key={row.submissionId} className="border-t border-line">
                          <td className="py-1">
                            {manualSubmissions.find((s) => s.id === row.submissionId)?.name ??
                              row.submissionId.slice(0, 8)}
                          </td>
                          <td className="py-1">{row.totalVotes}</td>
                          <td className="py-1">{row.voterCount}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <section>
            <h2 className="text-h2 font-semibold text-ink">Outlier judges</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Normalization already corrects for a judge who scores consistently high or low or with
              no variance. This is for cases that deserve a human look: a judge whose scores show
              essentially no spread, or whose relative ranking of submissions runs opposite to their
              peers&rsquo;. Flagging isn&rsquo;t a penalty; their scores are still counted.
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
                      {o.tooFewScores && (
                        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                          Too few scores to calibrate
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
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Duplicate submissions</h2>
            <DuplicatesReport eventId={eventId} />
          </section>
        </>
      )}

      {tab === "data" && (
        <>
          <section>
            <h2 className="text-h2 font-semibold text-ink">Export</h2>
            <p className="mt-1 text-xs leading-normal text-muted">
              Every export respects your organizer access, so nothing here contains data you
              couldn&rsquo;t otherwise see through the API. CSV and JSON carry the same rows.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXPORTABLE_RESOURCES.map((resource) => (
                <span
                  key={resource}
                  className="inline-flex overflow-hidden rounded-full border border-line"
                >
                  <a
                    href={`/api/v1/events/${eventId}/export/${resource}.csv`}
                    data-testid={`export-${resource}`}
                    className="bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-alt hover:text-accent"
                  >
                    {resource}.csv
                  </a>
                  <a
                    href={`/api/v1/events/${eventId}/export/${resource}.json`}
                    data-testid={`export-${resource}-json`}
                    className="border-l border-line bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-alt hover:text-accent"
                  >
                    .json
                  </a>
                </span>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Audit log</h2>
            {auditVerify && (
              <p
                data-testid="audit-verify-status"
                className={`mt-1 text-xs ${auditVerify.valid ? "text-success" : "text-danger"}`}
              >
                {auditVerify.valid
                  ? "Chain verified. No tampering detected."
                  : `Chain broken at entry ${auditVerify.brokenAt} (${auditVerify.reason}).`}
              </p>
            )}
            {auditEntries.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-muted">No audit entries yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="pb-1">When</th>
                    <th className="pb-1">Action</th>
                    <th className="pb-1">Resource</th>
                    <th className="pb-1">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className="py-1 text-xs text-muted">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="py-1">{a.actionLabel}</td>
                      <td className="py-1 text-xs text-muted">{a.resourceLabel}</td>
                      <td className="py-1 text-xs text-muted">{a.actorName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Certificates</h2>
            <p className="mt-1 text-xs leading-normal text-muted">
              PDF generation is queued and may take a few seconds. If a download link 404s,
              it&rsquo;s still rendering, so try again shortly.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium tracking-wide text-muted">Type</label>
                <select
                  data-testid="certificate-type"
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
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5" data-testid="certificate-recipients">
              {(certType === CERTIFICATE_TYPE.JUDGE
                ? judges
                    .filter((j) => j.status === INVITE_STATUS.ACCEPTED)
                    .map((j) => ({ userId: j.userId, label: j.name }))
                : teamsForEvent.flatMap((t) =>
                    t.members.map((m) => ({
                      userId: m.userId,
                      label: `${m.userName} (${t.name})`,
                    })),
                  )
              ).map((r) => {
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
              disabled={certRecipients.length === 0}
              data-testid="certificate-generate"
              onClick={() => {
                const labelById = new Map(
                  (certType === CERTIFICATE_TYPE.JUDGE
                    ? judges
                        .filter((j) => j.status === INVITE_STATUS.ACCEPTED)
                        .map((j) => ({ userId: j.userId, label: j.name }))
                    : teamsForEvent.flatMap((t) =>
                        t.members.map((m) => ({ userId: m.userId, label: m.userName })),
                      )
                  ).map((r) => [r.userId, r.label]),
                );
                run(
                  () =>
                    api
                      .post<{ id: string; type: string; recipientUserId: string }[]>(
                        `/events/${eventId}/certificates/generate`,
                        { type: certType, recipientIds: certRecipients },
                      )
                      .then((created) => {
                        setGeneratedCertificates((prev) => [
                          ...prev,
                          ...created.map((c) => ({
                            ...c,
                            recipientLabel: labelById.get(c.recipientUserId) ?? c.recipientUserId,
                          })),
                        ]);
                        loadAuditLog();
                      }),
                  "Certificates queued.",
                );
              }}
              className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
            >
              Generate
            </button>

            {generatedCertificates.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm" data-testid="certificate-list">
                {generatedCertificates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span>
                      {c.type} for {c.recipientLabel}
                    </span>
                    <a
                      href={`/api/v1/events/${eventId}/certificates/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-4 text-xs text-muted">
              Judge participation records are Ed25519-signed and independently verifiable at{" "}
              <code className="rounded bg-surface-alt px-1">/verify/judge-record/:recordId</code>,
              without authentication.
            </p>
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Bulk export</h2>
            <p className="mt-1 text-xs leading-normal text-muted">
              Export this event as a full archive to migrate it to another HackPulse instance.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={`/api/v1/events/${eventId}/export/archive`}
                data-testid="export-archive"
                className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt"
              >
                Download full event archive
              </a>
            </div>

            <hr className="my-4 border-line" />

            <h3 className="text-sm font-semibold text-ink">Import</h3>
            <p className="mt-1 text-xs leading-normal text-muted">
              Bulk-add teams, registrations, or submissions to <em>this</em> event via CSV or JSON.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium tracking-wide text-muted">
                  Resource
                </label>
                <select
                  value={csvImportResource}
                  onChange={(e) => setCsvImportResource(e.target.value as CsvImportResource)}
                  className="mt-1 rounded-md border border-line bg-paper px-3 py-2 text-sm"
                  data-testid="csv-import-resource"
                >
                  {CSV_IMPORT_RESOURCES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt cursor-pointer">
                Upload CSV or JSON…
                <input
                  type="file"
                  accept=".csv,text/csv,.json,application/json"
                  data-testid="csv-import-input"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) {
                      return;
                    }
                    setError(null);
                    setStatus(null);
                    setCsvImportReport(null);
                    try {
                      const text = await file.text();
                      const isJson = file.name.toLowerCase().endsWith(".json");
                      const body = isJson ? { json: JSON.parse(text) } : { csv: text };
                      const report = await api.post<CsvImportReport>(
                        `/events/${eventId}/import/${csvImportResource}`,
                        body,
                      );
                      setCsvImportReport(report);
                      setStatus(`Imported ${report.succeeded} of ${report.total} row(s).`);
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "Failed to import file");
                    }
                  }}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted">
              Columns:{" "}
              <code>
                {CSV_IMPORT_RESOURCES.find((r) => r.value === csvImportResource)?.columns}
              </code>
            </p>
            {csvImportReport && (
              <div className="mt-3" data-testid="csv-import-report">
                <p className="text-xs text-muted">
                  {csvImportReport.succeeded} succeeded, {csvImportReport.failed} failed, out of{" "}
                  {csvImportReport.total} row(s).
                </p>
                {csvImportReport.failed > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-warning">
                    {csvImportReport.results
                      .filter((r) => r.status === "error")
                      .map((r) => (
                        <li key={r.row}>
                          Row {r.row}: {r.message}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-h2 font-semibold text-ink">Embeddable gallery widget</h2>
            <p className="mt-1 text-xs leading-normal text-muted">
              Drop this into any page to show a live snapshot of your public gallery. Only works
              while gallery visibility is set to &ldquo;open&rdquo;.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium tracking-wide text-muted">Track</label>
                <select
                  data-testid="widget-track"
                  value={widgetTrackId}
                  onChange={(e) => setWidgetTrackId(e.target.value)}
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
              <div>
                <label className="block text-xs font-medium tracking-wide text-muted">Limit</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  data-testid="widget-limit"
                  value={widgetLimit}
                  onChange={(e) =>
                    setWidgetLimit(Math.min(24, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="mt-1 w-20 rounded-md border border-line px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium tracking-wide text-muted">Theme</label>
                <select
                  data-testid="widget-theme"
                  value={widgetTheme}
                  onChange={(e) => setWidgetTheme(e.target.value as "light" | "dark")}
                  className="mt-1 rounded-md border border-line px-3 py-2 text-sm"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>
            {(() => {
              const params = new URLSearchParams();
              if (widgetTrackId) {
                params.set("track", widgetTrackId);
              }
              params.set("limit", String(widgetLimit));
              params.set("theme", widgetTheme);
              const widgetUrl =
                typeof window !== "undefined"
                  ? `${window.location.origin}/api/v1/events/${eventId}/gallery/widget?${params.toString()}`
                  : "";
              const snippet = `<iframe src="${widgetUrl}" width="100%" height="480" style="border:0"></iframe>`;
              return (
                <div className="mt-3">
                  <textarea
                    readOnly
                    rows={2}
                    data-testid="widget-snippet"
                    value={snippet}
                    className="w-full rounded-md border border-line bg-surface-alt px-3 py-2 font-mono text-xs"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(snippet)
                        .then(() => setStatus("Embed code copied."))
                    }
                    className="mt-2 rounded-md border border-line bg-paper px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
                  >
                    Copy
                  </button>
                </div>
              );
            })()}
          </section>
        </>
      )}
    </div>
  );
}

type DuplicateGroup =
  | { kind: "exact"; key: string; submissions: { id: string; name: string }[] }
  | { kind: "thumbnail"; key: string; submissions: { id: string; name: string }[] }
  | {
      kind: "similar";
      key: string;
      similarity: number;
      submissions: { id: string; name: string }[];
    };

const DUPLICATE_KIND_LABEL: Record<DuplicateGroup["kind"], string> = {
  exact: "Exact match",
  thumbnail: "Same thumbnail",
  similar: "Similar text",
};

function DuplicatesReport({ eventId }: { eventId: string }) {
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);

  useEffect(() => {
    api
      .get<DuplicateGroup[]>(`/events/${eventId}/submissions/duplicates`)
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [eventId]);

  if (!groups) {
    return <LoadingState className="mt-2" />;
  }
  if (groups.length === 0) {
    return (
      <p className="mt-2 text-sm leading-relaxed text-muted">No likely duplicates detected.</p>
    );
  }

  return (
    <ul className="mt-3 space-y-2 text-sm">
      {groups.map((g) => (
        <li key={g.key} className="rounded-md border border-warning/30 bg-warning-soft p-3">
          <span className="mr-2 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
            {DUPLICATE_KIND_LABEL[g.kind]}
            {g.kind === "similar" && ` (${Math.round(g.similarity * 100)}%)`}
          </span>
          {g.submissions.map((s) => s.name).join(" ≈ ")}
        </li>
      ))}
    </ul>
  );
}
