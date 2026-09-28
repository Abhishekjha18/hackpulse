"use client";

import type { Comment, Submission } from "@hackpulse/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, LoadingState, TagPill, ThumbnailOrInitials } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function SubmissionDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const { user } = useAuth();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [commentError, setCommentError] = useState<string | null>(null);

  const loadComments = () =>
    api
      .get<Comment[]>(`/submissions/${submissionId}/comments`)
      .then(setComments)
      .catch(() => {});

  useEffect(() => {
    api
      .get<Submission>(`/submissions/${submissionId}`)
      .then(setSubmission)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load submission"));
    loadComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    setCommentError(null);
    try {
      await api.post(`/submissions/${submissionId}/comments`, { body });
      setBody("");
      loadComments();
    } catch (err) {
      setCommentError(err instanceof ApiError ? err.message : "Failed to post comment");
    }
  }

  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  if (!submission) {
    return <LoadingState />;
  }

  return (
    <div className="max-w-2xl">
      <div className="h-40 overflow-hidden rounded-xl border border-line">
        <ThumbnailOrInitials thumbnailUrl={submission.thumbnailUrl} name={submission.name} />
      </div>
      <h1 className="mt-5 text-h1 font-semibold text-ink">{submission.name}</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">{submission.tagline}</p>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {submission.description}
      </p>

      <div className="mt-3 flex flex-wrap gap-1">
        {submission.techTags.map((t) => (
          <TagPill key={t}>{t}</TagPill>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {submission.repoUrl && (
          <a
            href={submission.repoUrl}
            className="text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Repository
          </a>
        )}
        {submission.liveUrl && (
          <a
            href={submission.liveUrl}
            className="text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Live demo
          </a>
        )}
        {/* Found live while fixing a related gap on the pairwise judging
            card: this page (also used as the pairwise card's "Open full
            submission" link) never showed demoVideoUrl at all, even though
            it's a real submission field the judge/rubric page already
            links -- an oversight here specifically, not a deliberate
            omission. */}
        {submission.demoVideoUrl && (
          <a
            href={submission.demoVideoUrl}
            className="text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Demo video
          </a>
        )}
      </div>

      <h2 className="mt-10 text-h2 font-semibold text-ink">Comments</h2>
      <div data-testid="comment-list" className="mt-3 space-y-3">
        {comments.length === 0 && (
          <p className="text-sm leading-relaxed text-muted">No comments yet.</p>
        )}
        {comments.map((c) => {
          // The backend is the real authority (author or organizer/admin
          // of *this* comment's event) — Submission doesn't carry its
          // parent eventId, so this is a client-side heuristic that only
          // decides whether to show the button, not whether the action
          // succeeds. An organizer of a different event sees it too and
          // gets a clean 403 if they try; nothing unsafe about that.
          const canRemove =
            !!user &&
            (c.authorUserId === user.id || user.eventRoles.some((r) => r.role === "organizer"));
          return (
            <div
              key={c.id}
              data-testid="comment-item"
              className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface p-3 text-sm"
            >
              <div className="flex gap-3">
                <Avatar name={c.authorLabel} size={28} />
                <div>
                  <div className="font-medium text-ink">{c.authorLabel}</div>
                  <div className="mt-0.5 leading-relaxed text-muted">{c.body}</div>
                </div>
              </div>
              {canRemove && (
                <button
                  type="button"
                  data-testid={`comment-remove-${c.id}`}
                  onClick={async () => {
                    try {
                      await api.delete(`/comments/${c.id}`);
                      loadComments();
                    } catch (err) {
                      setCommentError(
                        err instanceof ApiError ? err.message : "Failed to remove comment",
                      );
                    }
                  }}
                  className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs font-medium text-muted hover:bg-surface-alt"
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>

      {user ? (
        <form onSubmit={postComment} className="mt-4 space-y-2">
          <textarea
            required
            rows={2}
            data-testid="comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment…"
            className="w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          {commentError && (
            <p data-testid="comment-error" className="text-sm text-danger">
              {commentError}
            </p>
          )}
          <button
            type="submit"
            data-testid="comment-submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
          >
            Post comment
          </button>
        </form>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted">Sign in to leave a comment.</p>
      )}
    </div>
  );
}
