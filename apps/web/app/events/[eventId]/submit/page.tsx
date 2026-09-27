"use client";

import type { Submission, Track } from "@hackpulse/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "../../../../lib/api";

export default function SubmitPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [existing, setExisting] = useState<Submission | null>(null);
  const [form, setForm] = useState({
    name: "",
    trackId: "",
    tagline: "",
    description: "",
    repoUrl: "",
    liveUrl: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Track[]>(`/events/${eventId}/tracks`)
      .then(setTracks)
      .catch(() => {});
    api
      .get<Submission[]>(`/events/${eventId}/submissions/mine`)
      .then((subs) => {
        const first = subs[0];
        if (first) {
          setExisting(first);
          setForm({
            name: first.name,
            trackId: first.trackId,
            tagline: first.tagline,
            description: first.description,
            repoUrl: first.repoUrl ?? "",
            liveUrl: first.liveUrl ?? "",
          });
        }
      })
      .catch(() => {});
  }, [eventId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (existing) {
        const wasSubmitted = existing.status === "submitted";
        const updated = await api.patch<Submission>(`/submissions/${existing.id}`, {
          name: form.name,
          tagline: form.tagline,
          description: form.description,
          repoUrl: form.repoUrl || null,
          liveUrl: form.liveUrl || null,
        });
        setExisting(updated);
        setMessage(
          wasSubmitted
            ? "Draft saved. This reverted to draft, so you'll need to submit again for judging."
            : "Draft saved.",
        );
      } else {
        const created = await api.post<Submission>(`/events/${eventId}/submissions`, {
          name: form.name,
          trackId: form.trackId,
          tagline: form.tagline,
          description: form.description,
          repoUrl: form.repoUrl || null,
          liveUrl: form.liveUrl || null,
        });
        setExisting(created);
        setMessage("Draft created.");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function submitFinal() {
    if (!existing) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<Submission>(`/submissions/${existing.id}/submit`);
      setExisting(updated);
      setMessage("Submitted! Your project is locked in for judging.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  const submitted = existing?.status === "submitted";

  return (
    <div className="max-w-xl">
      <h1 className="text-h1 font-semibold text-ink">
        {existing ? "Your submission" : "Submit a project"}
      </h1>
      {submitted && (
        <p className="mt-2 rounded-md bg-success-soft px-3 py-2 text-sm leading-relaxed text-success">
          Submitted. You can still edit until the deadline, but editing will revert it to a draft
          and you&rsquo;ll need to submit again for judging.
        </p>
      )}

      <form onSubmit={save} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Project name</label>
          <input
            required
            data-testid="submission-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Track</label>
          {existing ? (
            // trackId is immutable after creation (see UpdateSubmissionInput,
            // which omits it) — a judge may already be scoped/assigned
            // against it, so this is a display, not an editable field. Found
            // live: the field used to disappear entirely once a draft
            // existed, with no way to even see which track you were in.
            <p
              data-testid="submission-track-locked"
              className="mt-1 rounded-md border border-line bg-surface-alt px-3 py-2 text-sm text-muted"
            >
              {tracks.find((t) => t.id === form.trackId)?.name ?? "…"}
            </p>
          ) : (
            <select
              required
              data-testid="submission-track"
              value={form.trackId}
              onChange={(e) => setForm({ ...form, trackId: e.target.value })}
              className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Choose a track
              </option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Tagline</label>
          <input
            data-testid="submission-tagline"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Description</label>
          <textarea
            rows={4}
            data-testid="submission-description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">Repository URL</label>
          <input
            data-testid="submission-repo-url"
            value={form.repoUrl}
            onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium tracking-wide text-ink">
            Live / demo URL
          </label>
          <input
            data-testid="submission-live-url"
            value={form.liveUrl}
            onChange={(e) => setForm({ ...form, liveUrl: e.target.value })}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <p data-testid="submission-error" className="text-sm text-danger">
            {error}
          </p>
        )}
        {message && (
          <p data-testid="submission-message" className="text-sm text-success">
            {message}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={busy}
            data-testid="submission-save-draft"
            className="rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            Save draft
          </button>
          {existing && !submitted && (
            <button
              type="button"
              disabled={busy}
              onClick={submitFinal}
              data-testid="submission-submit-final"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
            >
              Submit for judging
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
