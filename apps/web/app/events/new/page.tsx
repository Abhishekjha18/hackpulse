"use client";

import type { Event } from "@hackpulse/shared";
import { GALLERY_VISIBILITY } from "@hackpulse/shared/constants";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
// datetime-local inputs both read and write local time with no timezone
// info, so defaults/conversion have to go through local getters/setters
// rather than the UTC-based isoInDays() this replaced — using UTC here
// would silently shift every default by the viewer's UTC offset.
function localInputValueInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewEventPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  // Requested explicitly: an event is either "automatic" (all six dates
  // set, status computed from them) or "manual" (none set, an organizer
  // drives status by hand) — never a mix, and permanent once created. See
  // EventsService's lifecycleModeOf/assertValidStatusTransition.
  const [lifecycleMode, setLifecycleMode] = useState<"automatic" | "manual">("automatic");
  const [registrationOpenAt, setRegistrationOpenAt] = useState(localInputValueInDays(1));
  const [registrationCloseAt, setRegistrationCloseAt] = useState(localInputValueInDays(7));
  const [submissionOpenAt, setSubmissionOpenAt] = useState(localInputValueInDays(7));
  const [submissionCloseAt, setSubmissionCloseAt] = useState(localInputValueInDays(14));
  const [judgingOpenAt, setJudgingOpenAt] = useState(localInputValueInDays(14));
  const [judgingCloseAt, setJudgingCloseAt] = useState(localInputValueInDays(21));
  const [coOrganizerEmails, setCoOrganizerEmails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && !user) {
    return <p className="text-sm text-muted">Sign in first to create an event.</p>;
  }
  // Found live: this had no role check at all — any registered user could
  // create an event. Now requires the same canOrganizeEvents/isAdmin gate
  // the backend enforces (EventsService.create) — checked here too so a
  // user without it sees a clear message instead of a 403 after filling
  // out the whole form.
  if (!loading && user && !user.isAdmin && !user.canOrganizeEvents) {
    return (
      <p className="text-sm leading-relaxed text-muted">
        You don&rsquo;t have permission to create events. Ask an admin to grant you organizer access
        from your profile page.
      </p>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const event = await api.post<Event>("/events", {
        name,
        slug:
          slug ||
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, ""),
        description,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // Manual mode omits all six entirely — CreateEventInput treats a
        // mix of set/unset as a validation error, so there's no partial
        // option here.
        ...(lifecycleMode === "automatic"
          ? {
              registrationOpenAt: new Date(registrationOpenAt).toISOString(),
              registrationCloseAt: new Date(registrationCloseAt).toISOString(),
              submissionOpenAt: new Date(submissionOpenAt).toISOString(),
              submissionCloseAt: new Date(submissionCloseAt).toISOString(),
              judgingOpenAt: new Date(judgingOpenAt).toISOString(),
              judgingCloseAt: new Date(judgingCloseAt).toISOString(),
            }
          : {}),
        galleryVisibility: GALLERY_VISIBILITY.OPEN,
      });
      const coOrganizerList = coOrganizerEmails
        .split(/[\n,]/)
        .map((email) => email.trim())
        .filter((email) => email.length > 0);
      if (coOrganizerList.length > 0) {
        const results = await Promise.allSettled(
          coOrganizerList.map((email) => api.post(`/events/${event.id}/organizers`, { email })),
        );
        const failed = coOrganizerList.filter((_email, i) => results[i].status === "rejected");
        if (failed.length > 0) {
          // Non-blocking — the event itself was created successfully, so
          // this only warns about the co-organizer invites specifically
          // (e.g. an email with no registered account yet) rather than
          // losing the whole event.
          window.alert(
            `Event created, but these co-organizer invites failed (they may not have an account yet): ${failed.join(", ")}`,
          );
        }
      }
      // The new event grants the creator an "organizer" eventRole, but
      // AuthProvider's cached `user` is a snapshot from login/last refresh —
      // without this, isOrganizer checks on the event page would read the
      // stale role list and hide the just-earned organizer dashboard link.
      await refresh();
      router.push(`/events/${event.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-h1 font-semibold text-ink">Create an event</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Dates default to a sensible schedule starting today, in your local timezone. Edit anything
        below, or change it later from the organizer dashboard.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Name</label>
          <input
            required
            data-testid="event-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">
            Slug <span className="text-muted">(optional, derived from name if blank)</span>
          </label>
          <input
            data-testid="event-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Description</label>
          <textarea
            rows={3}
            data-testid="event-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">
            How should this event&rsquo;s status change over time?
          </label>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Permanent once the event is created, it can&rsquo;t switch later.
          </p>
          <div className="mt-2 space-y-2">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="lifecycleMode"
                data-testid="lifecycle-mode-automatic"
                checked={lifecycleMode === "automatic"}
                onChange={() => setLifecycleMode("automatic")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Automatic</span>: set the six dates below now, status
                tracks them on its own.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="lifecycleMode"
                data-testid="lifecycle-mode-manual"
                checked={lifecycleMode === "manual"}
                onChange={() => setLifecycleMode("manual")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Manual</span>: no dates, move status by hand from the
                organizer dashboard as the event progresses.
              </span>
            </label>
          </div>
        </div>

        {lifecycleMode === "automatic" && (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Found live: every one of these could be typed in any order —
                submissionOpenAt before registrationCloseAt, judgingOpenAt
                before submissionCloseAt, etc. — and only surfaced as a
                confusing error (or, for the one pair the backend didn't
                check at all, not at all) on submit. Each field's `min` is
                now the previous field's current value, so the browser's
                own date picker won't offer an out-of-order date in the
                first place; the backend re-checks the same chain
                (registrationOpenAt < registrationCloseAt <= submissionOpenAt
                < submissionCloseAt <= judgingOpenAt < judgingCloseAt)
                regardless, since this is only ever a client-side steer,
                not the real guarantee. */}
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Registration opens
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-registration-open"
                value={registrationOpenAt}
                min={localInputValueInDays(0)}
                onChange={(e) => setRegistrationOpenAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Registration closes
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-registration-close"
                value={registrationCloseAt}
                min={registrationOpenAt}
                onChange={(e) => setRegistrationCloseAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Submissions open
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-submission-open"
                value={submissionOpenAt}
                min={registrationCloseAt}
                onChange={(e) => setSubmissionOpenAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Submission deadline
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-submission-close"
                value={submissionCloseAt}
                min={submissionOpenAt}
                onChange={(e) => setSubmissionCloseAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Judging opens
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-judging-open"
                value={judgingOpenAt}
                min={submissionCloseAt}
                onChange={(e) => setJudgingOpenAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium tracking-wide text-ink">
                Judging closes
              </label>
              <input
                required
                type="datetime-local"
                data-testid="event-judging-close"
                value={judgingCloseAt}
                min={judgingOpenAt}
                onChange={(e) => setJudgingCloseAt(e.target.value)}
                className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">
            Co-organizers <span className="font-normal text-muted">(optional)</span>
          </label>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            They&rsquo;ll have the same full control over this event as you do, once they accept the
            invite from their notifications. One email per line, or comma-separated. More can be
            added later from the event&rsquo;s dashboard.
          </p>
          <textarea
            data-testid="event-co-organizer-emails"
            value={coOrganizerEmails}
            onChange={(e) => setCoOrganizerEmails(e.target.value)}
            placeholder="teammate@example.com"
            rows={2}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          data-testid="event-create-submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create event"}
        </button>
      </form>
    </div>
  );
}
