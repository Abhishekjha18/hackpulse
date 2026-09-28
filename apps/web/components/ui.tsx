"use client";

import type { EventStatus } from "@hackpulse/shared";
import { useEffect, useState } from "react";

import { useTheme } from "../lib/theme-context";

const STATUS_STYLE: Record<EventStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-surface-alt text-muted" },
  registration_open: { label: "Registration open", className: "bg-success-soft text-success" },
  submissions_open: { label: "Submissions open", className: "bg-success-soft text-success" },
  judging: { label: "Judging", className: "bg-accent-soft text-accent-dark" },
  results_published: { label: "Results published", className: "bg-pulse-soft text-pulse" },
  archived: { label: "Archived", className: "bg-surface-alt text-muted" },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${s.className}`}
    >
      {s.label}
    </span>
  );
}

// Computed client-side from a deadline already on the event, so it needs
// no backend support. Ticks once a minute; renders nothing past the
// deadline so it never claims time is left when there isn't any.
export function CountdownChip({ deadline, label = "left" }: { deadline: string; label?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return null;
  }
  const diffMs = new Date(deadline).getTime() - now;
  if (diffMs <= 0) {
    return null;
  }

  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  const text = days >= 1 ? `${days}d ${hours}h ${label}` : `${hours}h ${label}`;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pulse-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold text-pulse">
      <span className="h-1.5 w-1.5 rounded-full bg-pulse" />
      {text}
    </span>
  );
}

export function PrizeChip({ name, amount }: { name: string; amount?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border border-line bg-surface-alt px-2.5 py-1 text-xs">
      {amount && <span className="font-mono font-semibold text-ink">{amount}</span>}
      <span className="text-muted">{name}</span>
    </span>
  );
}

const AVATAR_HUES = ["#5B4FE0", "#EF5A2A", "#1C8A5C", "#A9760B", "#4438B8", "#C4432E"];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const bg = AVATAR_HUES[hashString(name) % AVATAR_HUES.length];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-surface font-mono font-semibold text-white"
      style={{ backgroundColor: bg, width: size, height: size, fontSize: size * 0.4 }}
      title={name}
    >
      {initials || "?"}
    </span>
  );
}

export function VoteBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-pulse">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-10-9.1C.4 8.3 2 4.5 5.8 4c2-.3 3.9.7 6.2 3 2.3-2.3 4.2-3.3 6.2-3C21.9 4.5 23.6 8.3 22 11.9 19.5 16.4 12 21 12 21z" />
      </svg>
      {count}
    </span>
  );
}

export function TagPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-alt px-2 py-0.5 text-xs text-muted">{children}</span>
  );
}

// A spinner reads as "something is happening" at a glance better than
// static text. `className` lets each call site keep its own spacing
// (mt-2, mt-4, ...) instead of this component owning it.
export function LoadingState({
  label = "Loading…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <p className={`flex items-center gap-2 text-xs leading-normal text-muted ${className}`}>
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
      />
      {label}
    </p>
  );
}

// Styled stand-in for window.confirm(), which can't be themed and looks
// jarring next to the rest of the app. Renders nothing when closed; the
// caller owns the open/pending state (see useConfirm below).
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 motion-safe:animate-[backdrop-in_150ms_ease-out]"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-xl motion-safe:animate-[dialog-in_180ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h3 className="text-h3 font-semibold text-ink">{title}</h3>}
        <p className={`text-sm leading-relaxed text-muted ${title ? "mt-1.5" : ""}`}>{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
              danger ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-dark"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Pairs with ConfirmDialog: replaces `if (!confirm(msg)) return; doIt();`
// call sites with `ask(msg, doIt)`.
export function useConfirm() {
  const [pending, setPending] = useState<{ message: string; onConfirm: () => void } | null>(null);

  function ask(message: string, onConfirm: () => void) {
    setPending({ message, onConfirm });
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      message={pending?.message ?? ""}
      danger
      confirmLabel="Remove"
      onConfirm={() => {
        pending?.onConfirm();
        setPending(null);
      }}
      onCancel={() => setPending(null)}
    />
  );

  return { ask, dialog };
}

// Fallback for a submission with no thumbnailUrl: initials plus a
// deterministic color from the same hash Avatar uses, so identity stays
// visually consistent across the app.
export function ThumbnailOrInitials({
  thumbnailUrl,
  name,
  className = "",
}: {
  thumbnailUrl?: string | null;
  name: string;
  className?: string;
}) {
  if (thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumbnailUrl} alt="" className={`h-full w-full object-cover ${className}`} />;
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const hue = hashString(name) % 2 === 0 ? "from-accent-soft" : "from-pulse-soft";
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${hue} to-surface-alt ${className}`}
    >
      <span className="text-2xl font-semibold text-accent-dark">{initials || "?"}</span>
    </div>
  );
}

// Same idea as ThumbnailOrInitials, for an event with no bannerImageUrl.
// The dot-grid texture (see GraphPaperOverlay) makes it read as a
// deliberate placeholder rather than a flat, blank box.
export function EventBannerOrDefault({
  bannerImageUrl,
  name,
  className = "",
}: {
  bannerImageUrl?: string | null;
  name: string;
  className?: string;
}) {
  if (bannerImageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={bannerImageUrl} alt="" className={`w-full object-cover ${className}`} />;
  }
  const bg = AVATAR_HUES[hashString(name) % AVATAR_HUES.length];
  return (
    <div
      className={`w-full ${className}`}
      style={{
        backgroundColor: bg,
        backgroundImage: "radial-gradient(rgb(255 255 255 / 0.18) 1.5px, transparent 1.5px)",
        backgroundSize: "18px 18px",
      }}
    />
  );
}

// Deliberately manual, never follows prefers-color-scheme. Theme state
// lives in ThemeProvider (app/layout.tsx) so other components, like the
// homepage's theme-matched screenshots, can read the same value.
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      data-testid="theme-toggle"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-md p-1.5 text-muted hover:bg-surface-alt hover:text-ink"
    >
      {isDark ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4.5" />
          <path
            strokeLinecap="round"
            d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
          />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"
          />
        </svg>
      )}
    </button>
  );
}
