"use client";

import type { Team, TeamMember } from "@hackpulse/shared";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

type TeamWithMembers = Team & { members: TeamMember[] };

export default function TeamPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const [team, setTeam] = useState<TeamWithMembers | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .get<TeamWithMembers | null>(`/events/${eventId}/teams/mine`)
      .then(setTeam)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  };

  useEffect(load, [eventId]);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/events/${eventId}/teams`, { name });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create team");
    } finally {
      setBusy(false);
    }
  }

  async function joinTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/teams/join", { inviteCode });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to join team");
    } finally {
      setBusy(false);
    }
  }

  if (team === undefined) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  // Found live: this page showed the create/join forms to everyone,
  // organizers and judges included — the backend has always rejected the
  // attempt (a structural conflict of interest, same block in the other
  // direction on accepting a judge/co-organizer invite), but nothing told
  // the person *why* before they tried. Checked against the same
  // eventRoles the backend authorizes against, not a separate query.
  const isOrganizerOrJudge = user?.eventRoles.some(
    (r) => r.eventId === eventId && (r.role === "organizer" || r.role === "judge"),
  );
  if (!team && isOrganizerOrJudge) {
    return (
      <p className="max-w-lg text-sm leading-relaxed text-muted">
        You organize or judge this event, so you can&rsquo;t also register a team for it.
      </p>
    );
  }

  if (team) {
    const isOwner = user?.id === team.ownerUserId;

    function removeMember(userId: string, label: string) {
      if (!window.confirm(`Remove ${label} from the team?`)) {
        return;
      }
      api
        .delete(`/teams/${team!.id}/members/${userId}`)
        .then(() => load())
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : "Failed to remove member"),
        );
    }

    return (
      <div className="max-w-lg">
        <h1 className="text-h1 font-semibold text-ink">{team.name}</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Invite code:{" "}
          <span data-testid="team-invite-code" className="font-mono font-medium text-ink">
            {team.inviteCode}
          </span>
        </p>
        {error && (
          <p data-testid="team-error" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <h2 className="mt-6 text-h2 font-semibold text-ink">Members</h2>
        <ul data-testid="team-members" className="mt-2 space-y-2">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm text-ink">
              <span className="flex items-center gap-2">
                <Link href={`/users/${m.userId}`} className="hover:underline">
                  {m.userName}
                </Link>
                {m.userId === team.ownerUserId ? <span className="text-muted"> (owner)</span> : ""}
              </span>
              {isOwner && m.userId !== team.ownerUserId && (
                <button
                  type="button"
                  data-testid={`team-remove-member-${m.userId}`}
                  onClick={() => removeMember(m.userId, m.userName)}
                  className="rounded-md border border-line bg-paper px-2 py-0.5 text-xs font-medium text-muted hover:bg-surface-alt"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {!isOwner && user && (
          <button
            type="button"
            data-testid="team-leave"
            onClick={() => {
              if (!window.confirm("Leave this team?")) {
                return;
              }
              api
                .delete(`/teams/${team.id}/members/${user.id}`)
                .then(() => load())
                .catch((err) =>
                  setError(err instanceof ApiError ? err.message : "Failed to leave team"),
                );
            }}
            className="mt-6 rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt"
          >
            Leave team
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid max-w-2xl gap-8 sm:grid-cols-2">
      <form onSubmit={createTeam} className="space-y-3">
        <h2 className="text-h2 font-semibold text-ink">Create a team</h2>
        <input
          required
          placeholder="Team name"
          data-testid="team-create-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-line px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          data-testid="team-create-submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
        >
          Create
        </button>
      </form>
      <form onSubmit={joinTeam} className="space-y-3">
        <h2 className="text-h2 font-semibold text-ink">Join with an invite code</h2>
        <input
          required
          placeholder="Invite code"
          data-testid="team-join-code"
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
          className="w-full rounded-md border border-line px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy}
          data-testid="team-join-submit"
          className="w-full rounded-md border border-line bg-paper px-4 py-2 text-sm font-medium hover:bg-surface-alt disabled:opacity-50"
        >
          Join
        </button>
      </form>
      {error && (
        <p data-testid="team-error" className="text-sm text-danger sm:col-span-2">
          {error}
        </p>
      )}
    </div>
  );
}
