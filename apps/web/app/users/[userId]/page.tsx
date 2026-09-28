"use client";

import type { Profile, ProfileField, PublicProfile } from "@hackpulse/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, LoadingState, TagPill } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const FIELD_LABELS: Record<ProfileField, string> = {
  bio: "Bio",
  workplace: "Workplace",
  skills: "Skills",
  githubUrl: "GitHub",
  linkedinUrl: "LinkedIn",
  websiteUrl: "Website",
};

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.id === userId;

  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [mine, setMine] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skillsText, setSkillsText] = useState("");
  const [organizerBusy, setOrganizerBusy] = useState(false);

  useEffect(() => {
    api
      .get<PublicProfile>(`/users/${userId}/profile`)
      .then(setPublicProfile)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load profile"));
  }, [userId]);

  useEffect(() => {
    if (!isOwner) {
      return;
    }
    api
      .get<Profile>("/users/me/profile")
      .then((p) => {
        setMine(p);
        setSkillsText(p.skills.join(", "));
      })
      .catch(() => {});
  }, [isOwner]);

  function toggleVisible(field: ProfileField) {
    if (!mine) {
      return;
    }
    const has = mine.visibleFields.includes(field);
    setMine({
      ...mine,
      visibleFields: has
        ? mine.visibleFields.filter((f) => f !== field)
        : [...mine.visibleFields, field],
    });
  }

  // Admin-only — the only place a user's site-wide organizer capability
  // ("may create/organize events") can be granted or revoked; there's no
  // separate admin panel anywhere in the app. Only shown to an admin
  // viewer looking at someone else's profile (the fields this reads never
  // come back from the API otherwise — see ProfilesService.getPublic).
  async function toggleOrganizerStatus() {
    if (!publicProfile) {
      return;
    }
    setOrganizerBusy(true);
    setError(null);
    try {
      const next = !publicProfile.canOrganizeEvents;
      await api.patch(`/users/${userId}/organizer-status`, { canOrganizeEvents: next });
      setPublicProfile({ ...publicProfile, canOrganizeEvents: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update organizer access");
    } finally {
      setOrganizerBusy(false);
    }
  }

  async function save() {
    if (!mine) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const skills = skillsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await api.patch<Profile>("/users/me/profile", {
        bio: mine.bio,
        workplace: mine.workplace,
        skills,
        githubUrl: mine.githubUrl || null,
        linkedinUrl: mine.linkedinUrl || null,
        websiteUrl: mine.websiteUrl || null,
        visibleFields: mine.visibleFields,
      });
      setMine(updated);
      setSkillsText(updated.skills.join(", "));
      setStatus("Profile saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  }

  if (error && !publicProfile) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!publicProfile) {
    return <LoadingState />;
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3">
        <Avatar name={publicProfile.name} size={48} />
        <h1 className="text-h1 font-semibold text-ink">{publicProfile.name}</h1>
      </div>

      {currentUser?.isAdmin && !isOwner && !publicProfile.isAdmin && (
        <div
          data-testid="admin-organizer-control"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
        >
          <span className="text-ink">
            Organizer access:{" "}
            <span className="font-medium">
              {publicProfile.canOrganizeEvents ? "Granted" : "Not granted"}
            </span>
          </span>
          <button
            type="button"
            onClick={toggleOrganizerStatus}
            disabled={organizerBusy}
            data-testid="toggle-organizer-status"
            className="rounded-md border border-line bg-paper px-3 py-1.5 text-xs font-medium hover:bg-surface-alt disabled:opacity-50"
          >
            {publicProfile.canOrganizeEvents ? "Revoke" : "Grant"} organizer access
          </button>
        </div>
      )}

      {!isOwner && (
        <div className="mt-6 space-y-4">
          {publicProfile.workplace && (
            <p className="text-sm leading-relaxed text-ink">
              <span className="text-muted">Works at </span>
              {publicProfile.workplace}
            </p>
          )}
          {publicProfile.bio && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {publicProfile.bio}
            </p>
          )}
          {publicProfile.skills && publicProfile.skills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {publicProfile.skills.map((s) => (
                <TagPill key={s}>{s}</TagPill>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-sm">
            {publicProfile.githubUrl && (
              <a
                href={publicProfile.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                GitHub
              </a>
            )}
            {publicProfile.linkedinUrl && (
              <a
                href={publicProfile.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                LinkedIn
              </a>
            )}
            {publicProfile.websiteUrl && (
              <a
                href={publicProfile.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Website
              </a>
            )}
          </div>
          {!publicProfile.bio &&
            !publicProfile.workplace &&
            (!publicProfile.skills || publicProfile.skills.length === 0) &&
            !publicProfile.githubUrl &&
            !publicProfile.linkedinUrl &&
            !publicProfile.websiteUrl && (
              <p className="text-sm leading-relaxed text-muted">
                This person hasn&rsquo;t shared any profile details.
              </p>
            )}
        </div>
      )}

      {isOwner && mine && (
        <div className="mt-6 space-y-5">
          <p className="text-xs leading-normal text-muted">
            Toggle &ldquo;Visible to others&rdquo; on each field to control what other users can see
            on this page. Hidden fields are always visible to you and to admins.
          </p>

          {(
            [
              {
                field: "workplace" as const,
                input: (
                  <input
                    value={mine.workplace}
                    onChange={(e) => setMine({ ...mine, workplace: e.target.value })}
                    placeholder="e.g. Acme Corp"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
              {
                field: "bio" as const,
                input: (
                  <textarea
                    rows={4}
                    value={mine.bio}
                    onChange={(e) => setMine({ ...mine, bio: e.target.value })}
                    placeholder="A short bio…"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
              {
                field: "skills" as const,
                input: (
                  <input
                    value={skillsText}
                    onChange={(e) => setSkillsText(e.target.value)}
                    placeholder="React, PostgreSQL, ML (comma-separated)"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
              {
                field: "githubUrl" as const,
                input: (
                  <input
                    value={mine.githubUrl ?? ""}
                    onChange={(e) => setMine({ ...mine, githubUrl: e.target.value })}
                    placeholder="https://github.com/…"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
              {
                field: "linkedinUrl" as const,
                input: (
                  <input
                    value={mine.linkedinUrl ?? ""}
                    onChange={(e) => setMine({ ...mine, linkedinUrl: e.target.value })}
                    placeholder="https://linkedin.com/in/…"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
              {
                field: "websiteUrl" as const,
                input: (
                  <input
                    value={mine.websiteUrl ?? ""}
                    onChange={(e) => setMine({ ...mine, websiteUrl: e.target.value })}
                    placeholder="https://…"
                    className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                  />
                ),
              },
            ] satisfies { field: ProfileField; input: React.ReactNode }[]
          ).map(({ field, input }) => (
            <div key={field}>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium tracking-wide text-ink">
                  {FIELD_LABELS[field]}
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={mine.visibleFields.includes(field)}
                    onChange={() => toggleVisible(field)}
                    data-testid={`profile-visible-${field}`}
                  />
                  Visible to others
                </label>
              </div>
              {input}
            </div>
          ))}

          {error && <p className="text-sm text-danger">{error}</p>}
          {status && <p className="text-sm text-success">{status}</p>}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            data-testid="profile-save"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
          >
            Save profile
          </button>
        </div>
      )}
      {isOwner && !mine && <LoadingState className="mt-6" />}
    </div>
  );
}
