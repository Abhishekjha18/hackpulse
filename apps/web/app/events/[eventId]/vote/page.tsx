"use client";

import type { Event, Submission } from "@hackpulse/shared";
import { VOTING_ACCESS, VOTING_MODE } from "@hackpulse/shared/constants";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingState } from "../../../../components/ui";
import { api, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
function getVoterToken(): string {
  const key = "hackpulse_voter_token";
  let token = window.localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(key, token);
  }
  return token;
}

export default function VotePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [ballot, setBallot] = useState<Submission[] | null>(null);
  const [votesInput, setVotesInput] = useState<Record<string, number>>({});
  const [voterEmail, setVoterEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const emailGated = !user && event?.votingAccess === VOTING_ACCESS.EMAIL_GATED;

  function headers(): Record<string, string> {
    if (user) {
      return {};
    }
    if (emailGated) {
      return { "X-Voter-Email": voterEmail.trim() };
    }
    return { "X-Voter-Token": getVoterToken() };
  }

  useEffect(() => {
    api
      .get<Event>(`/events/${eventId}`)
      .then(setEvent)
      .catch(() => {});
    fetch(`/api/v1/events/${eventId}/ballot`, {
      headers: user ? {} : { "X-Voter-Token": getVoterToken() },
    })
      .then((r) => r.json())
      .then(setBallot)
      .catch(() => setError("Failed to load ballot"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user]);

  async function castVote(submissionId: string) {
    setError(null);
    setMessage(null);
    if (emailGated && !voterEmail.trim()) {
      setError("Enter your email to vote in this event.");
      return;
    }
    try {
      const res = await fetch(`/api/v1/events/${eventId}/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ submissionId, votes: votesInput[submissionId] ?? 1 }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new ApiError(res.status, body?.error?.code, body?.error?.message ?? "Vote failed");
      }
      setMessage(`Vote recorded (cost: ${body.costPaid ?? 1}).`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to vote");
    }
  }

  if (error && !ballot) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!ballot) {
    return <LoadingState />;
  }

  return (
    <div>
      <h1 className="text-h1 font-semibold text-ink">Cast your vote</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Ballot order is randomized per voter to avoid position bias.
      </p>
      {emailGated && (
        <div className="mt-4 max-w-sm">
          <label className="block text-xs font-medium tracking-wide text-ink">Your email</label>
          <input
            type="email"
            required
            placeholder="you@example.com"
            data-testid="voter-email"
            value={voterEmail}
            onChange={(e) => setVoterEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs leading-normal text-muted">
            This event limits one vote per email address. We don&rsquo;t verify you own it, since
            it&rsquo;s only used to prevent one person voting many times from the same browser.
          </p>
        </div>
      )}
      {error && (
        <p data-testid="vote-error" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {message && (
        <p data-testid="vote-message" className="mt-2 text-sm text-success">
          {message}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {ballot.map((s) => (
          <div
            key={s.id}
            data-testid="ballot-item"
            className="flex items-center justify-between rounded-lg border border-line bg-surface p-4"
          >
            <div>
              <div className="text-sm font-medium text-ink">{s.name}</div>
              <div className="text-xs leading-normal text-muted">{s.tagline}</div>
            </div>
            <div className="flex items-center gap-2">
              {event?.votingMode === VOTING_MODE.QUADRATIC && (
                <input
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={1}
                  data-testid="vote-count-input"
                  onChange={(e) => {
                    // Clamped here too, not just by the backend's
                    // CastVoteInput (int, min 1) — typing 0 or a negative
                    // number is meaningless for a vote count, so it's
                    // corrected immediately rather than left to bounce back
                    // as a server error.
                    const raw = Math.floor(Number(e.target.value));
                    setVotesInput({
                      ...votesInput,
                      [s.id]: Number.isFinite(raw) ? Math.max(1, raw) : 1,
                    });
                  }}
                  className="w-16 rounded-md border border-line px-2 py-1 text-sm"
                />
              )}
              <button
                onClick={() => castVote(s.id)}
                data-testid="vote-cast-button"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark"
              >
                Vote
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
