"use client";

import type { Event } from "@hackpulse/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { CountdownChip, EventBannerOrDefault, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTheme } from "../lib/theme-context";
import { useInView } from "../lib/use-in-view";

interface InstanceStats {
  eventCount: number;
  submissionCount: number;
  judgeCount: number;
  teamCount: number;
  participantCount: number;
}

interface EventListItem extends Event {
  submissionCount: number;
  prizeNames: string[];
  createdAt: string;
}

const FEATURES = [
  {
    title: "Weighted, organizer-configurable rubrics",
    body: "Define per-criterion weights for each track or the whole event instead of a single fixed rubric everyone shares. The math is enforced server-side, not just in the form.",
  },
  {
    title: "Cross-judge normalization",
    body: "A z-score correction runs automatically so one harsh or lenient judge doesn't skew the ranking. Raw and normalized scores are both kept, always.",
  },
  {
    title: "A tamper-evident audit log",
    body: "Every sensitive action is hash-chained to the one before it. An organizer can verify the whole chain independently, not just trust that nothing was edited.",
  },
  {
    title: "Signed, verifiable certificates",
    body: "Judge-participation records are Ed25519-signed and publicly verifiable. Anyone can confirm one is genuine without an account or asking the organizer.",
  },
];

// The pre-reveal hidden state only applies under motion-safe:, so a
// reduced-motion visitor always sees the plain, fully visible state.
function revealClass(revealed: boolean): string {
  return revealed
    ? "transition-all duration-700 ease-out opacity-100 translate-y-0"
    : "transition-all duration-700 ease-out motion-safe:opacity-0 motion-safe:translate-y-6";
}

// Small and varied per shape so it reads as depth rather than a single
// block moving; capped in the scroll handler so it never drifts far.
const HERO_PARALLAX_RATES = [0.16, 0.22, 0.12, 0.18];

// The actual events browser lives at /events (linked from the nav and
// both CTAs below). Kept separate on purpose: a first-time visitor and a
// returning participant want different things from "/".
export default function HomePage() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [stats, setStats] = useState<InstanceStats | null>(null);
  const [activeEvents, setActiveEvents] = useState<EventListItem[] | null>(null);

  useEffect(() => {
    api
      .get<InstanceStats>("/events/stats")
      .then(setStats)
      .catch(() => {});
    api
      .get<{ items: EventListItem[] }>("/events?phase=active&limit=3")
      .then((r) => setActiveEvents(r.items))
      .catch(() => {});
  }, []);

  const heroParallaxRefs = useRef<Array<HTMLSpanElement | null>>([null, null, null, null]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let raf = 0;
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        heroParallaxRefs.current.forEach((el, i) => {
          if (!el) {
            return;
          }
          const offset = Math.min(y * HERO_PARALLAX_RATES[i], 60);
          el.style.transform = `translateY(${offset}px)`;
        });
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const stats_ = useInView<HTMLElement>();
  const features = useInView<HTMLElement>();
  const screenshots = useInView<HTMLElement>();
  const happening = useInView<HTMLElement>();

  return (
    <div>
      {/* Decorative accents hidden below sm: at hero-text width they'd sit
          on top of the copy instead of around it. Each shape is two nested
          spans so the scroll-linked parallax translateY and the idle
          drift/spin animation don't both fight over `transform` on the
          same element. Heading/subtext/CTAs fade in once on mount, not
          scroll-triggered, since the hero should be visible immediately. */}
      <section className="relative overflow-hidden py-10 text-center sm:py-16">
        <span
          ref={(el) => {
            heroParallaxRefs.current[0] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute left-[8%] top-6 hidden sm:block"
        >
          <span className="block h-10 w-10 rounded-full border-2 border-accent/35 motion-safe:animate-[decorative-drift_4s_ease-in-out_0s_infinite]" />
        </span>
        <span
          ref={(el) => {
            heroParallaxRefs.current[1] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute right-[12%] top-14 hidden sm:block"
        >
          <span className="block h-4 w-4 rounded-full bg-pulse/45 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0.4s_infinite]" />
        </span>
        <span
          ref={(el) => {
            heroParallaxRefs.current[2] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-8 left-[15%] hidden sm:block"
        >
          <span className="block h-6 w-6 rounded-md border-2 border-ink/20 motion-safe:animate-[decorative-spin-cw_14s_linear_infinite]" />
        </span>
        <span
          ref={(el) => {
            heroParallaxRefs.current[3] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-4 right-[10%] hidden sm:block"
        >
          <span className="block h-14 w-14 rounded-full border-2 border-accent/35 motion-safe:animate-[decorative-drift_6s_ease-in-out_0.7s_infinite]" />
        </span>
        <h1 className="relative mx-auto max-w-2xl text-display font-semibold text-ink motion-safe:animate-[hero-in_600ms_ease-out_both]">
          Run a hackathon end to end, with judging you can trust.
        </h1>
        <p
          style={{ animationDelay: "100ms" }}
          className="relative mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted motion-safe:animate-[hero-in_600ms_ease-out_both] sm:text-base"
        >
          Registration, teams, submissions, weighted judging, cross-judge normalization, and signed
          certificates all on one self-hosted product.
        </p>
        <div
          style={{ animationDelay: "200ms" }}
          className="relative mt-7 flex flex-wrap items-center justify-center gap-3 motion-safe:animate-[hero-in_600ms_ease-out_both]"
        >
          <Link
            href="/events"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-dark motion-safe:active:scale-[0.97]"
          >
            Browse events
          </Link>
          <Link
            href={user ? "/events/new" : "/register"}
            className="rounded-md border border-line bg-paper px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-surface-alt motion-safe:active:scale-[0.97]"
          >
            Host an event
          </Link>
        </div>
      </section>

      {/* Real, live stats — not aspirational numbers. Instance-wide across
          every event regardless of phase (active or archived — see
          EventsService.getInstanceStats), not just what's active right
          now: a completed hackathon's history is exactly the kind of
          evidence a prospective organizer or judge is looking for. */}
      {stats && (stats.eventCount > 0 || stats.submissionCount > 0) && (
        <section
          ref={stats_.ref}
          data-testid="instance-stats"
          className={`grid grid-cols-3 gap-4 border-y border-line py-8 text-center sm:grid-cols-5 ${revealClass(stats_.revealed)}`}
        >
          {(
            [
              [stats.eventCount, `Event${stats.eventCount === 1 ? "" : "s"} hosted`],
              [stats.submissionCount, "Submissions"],
              [stats.teamCount, `Team${stats.teamCount === 1 ? "" : "s"} formed`],
              [stats.participantCount, `Participant${stats.participantCount === 1 ? "" : "s"}`],
              [stats.judgeCount, `Judge${stats.judgeCount === 1 ? "" : "s"}`],
            ] as const
          ).map(([value, label]) => (
            <div key={label}>
              <div className="font-mono text-3xl font-semibold text-ink sm:text-4xl">{value}</div>
              <div className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                {label}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* What actually makes this different, stated plainly */}
      <section ref={features.ref} className="py-12">
        <h2 className="text-center text-h2 font-semibold text-ink">What you get</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              style={{ transitionDelay: `${i * 90}ms` }}
              className={`rounded-xl border border-line bg-surface p-5 ${revealClass(features.revealed)}`}
            >
              <h3 className="text-h3 font-semibold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Real product screenshots, not stock illustration */}
      <section ref={screenshots.ref} className="py-12">
        <h2 className="text-center text-h2 font-semibold text-ink">
          Built for organizers, judges, and participants
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            { base: "dashboard", label: "Organizer dashboard" },
            { base: "gallery", label: "Public gallery" },
            { base: "scoring", label: "Judge scoring" },
          ].map((shot, i) => (
            <div
              key={shot.base}
              style={{ transitionDelay: `${i * 90}ms` }}
              className={`overflow-hidden rounded-xl border border-line bg-surface shadow-sm ${revealClass(screenshots.revealed)}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/screenshots/${shot.base}-${theme}.png`}
                alt={shot.label}
                className="w-full border-b border-line"
              />
              <p className="p-3 text-center text-sm font-medium text-ink">{shot.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Active events preview, feeding into the full browser */}
      {activeEvents && activeEvents.length > 0 && (
        <section ref={happening.ref} className="py-12">
          <div className="flex items-center justify-between">
            <h2 className="text-h2 font-semibold text-ink">Happening now</h2>
            <Link href="/events" className="text-sm text-accent hover:underline">
              View all →
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {activeEvents.map((event, i) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                style={{ transitionDelay: `${i * 90}ms` }}
                className={`overflow-hidden rounded-xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md ${revealClass(happening.revealed)}`}
              >
                <EventBannerOrDefault
                  bannerImageUrl={event.bannerImageUrl}
                  name={event.name}
                  className="h-28 border-b border-line"
                />
                <div className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={event.displayStatus} />
                    {event.displayStatus === "submissions_open" && event.submissionCloseAt && (
                      <CountdownChip deadline={event.submissionCloseAt} />
                    )}
                  </div>
                  <h3 className="mt-3 text-h3 font-semibold text-ink">{event.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                    {event.description}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
