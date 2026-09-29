import {
  type CurrentUser,
  EVENT_ROLE,
  GALLERY_VISIBILITY,
  SUBMISSION_STATUS,
} from "@hackpulse/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ilike, inArray, or } from "drizzle-orm";

import type { Database } from "../db/client";
import { events, submissions, teams, user } from "../db/schema";
import { DB } from "../db/tokens";
import { computeDisplayStatus, isVisibleCondition } from "../events/events.service";

const DEFAULT_RESULTS_PER_KIND = 5;
const MAX_RESULTS_PER_KIND = 50;
// How many candidates to pull per category before sorting/capping in JS,
// well above MAX_RESULTS_PER_KIND so natural-sort order is correct for any
// realistic match count, while still bounding a pathological query (e.g.
// a single common letter) on a large instance.
const SAFETY_FETCH_CAP = 300;

// Plain SQL ORDER BY is lexicographic: "Participant 10" sorts before
// "Participant 2" because '1' < '2' as characters. Intl.Collator's
// `numeric` option treats embedded digit runs as numbers instead, so
// "Participant 2" correctly sorts before "Participant 10" (found live:
// searching "participant" listed 1, 10, 2, 3, 4).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function naturalSortBy<T>(rows: T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => collator.compare(key(a), key(b)));
}

@Injectable()
export class SearchService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // A single quick-find across the three kinds of thing this app actually
  // has to look up by name: events, projects, and people. Deliberately
  // excludes anything judge/organizer-only (scores, audit log, raw
  // assignments); those aren't things "search" should surface, and the
  // dedicated pages for them already have their own access control.
  // Reuses each domain's own existing visibility rule rather than
  // inventing a new one here, so a result never appears in search that
  // the same caller couldn't already reach directly.
  async search(query: string, currentUser: CurrentUser | null, requestedLimit?: number) {
    const limit = Math.min(
      Math.max(requestedLimit ?? DEFAULT_RESULTS_PER_KIND, 1),
      MAX_RESULTS_PER_KIND,
    );
    const term = `%${query}%`;
    const ownedEventIds = new Set(
      currentUser?.eventRoles
        .filter((r) => r.role === EVENT_ROLE.ORGANIZER)
        .map((r) => r.eventId) ?? [],
    );

    // Events: same visibility rule as EventsService.list (isVisibleCondition
    // — public once non-draft, or automatic-mode with registrationOpenAt
    // already passed), or any status if the caller organizes it. isAdmin no
    // longer exempts this, same posture as EventsService.list.
    const eventConditions = [or(ilike(events.name, term), ilike(events.description, term))!];
    {
      const roleEventIds = [...ownedEventIds];
      eventConditions.push(
        roleEventIds.length > 0
          ? or(isVisibleCondition(), inArray(events.id, roleEventIds))!
          : isVisibleCondition(),
      );
    }
    // Over-fetched and naturally sorted in JS (not just ORDER BY) so
    // "more exist than fit in the dropdown" is a known fact (hasMore), not
    // silent data loss, and so which subset shows is meaningful; see
    // naturalSortBy above.
    const eventCandidates = await this.db
      .select({
        id: events.id,
        name: events.name,
        status: events.status,
        registrationOpenAt: events.registrationOpenAt,
        submissionOpenAt: events.submissionOpenAt,
        judgingOpenAt: events.judgingOpenAt,
      })
      .from(events)
      .where(and(...eventConditions))
      .limit(SAFETY_FETCH_CAP);
    const sortedEvents = naturalSortBy(eventCandidates, (e) => e.name);
    const eventResults = sortedEvents
      .slice(0, limit)
      .map(({ registrationOpenAt, submissionOpenAt, judgingOpenAt, ...e }) => ({
        ...e,
        displayStatus: computeDisplayStatus({
          status: e.status,
          registrationOpenAt,
          submissionOpenAt,
          judgingOpenAt,
        }),
      }));
    const eventsHasMore = sortedEvents.length > limit;

    // Submissions: must be submitted, and visible per the same
    // gallery-visibility rule GalleryService.list enforces (hidden: only
    // that event's organizer/admin; participants_only: any signed-in
    // caller or that event's organizer/admin; open: everyone). Overfetch
    // and filter in process rather than a per-row correlated subquery,
    // same posture as the homepage's submission-count aggregation.
    const submissionCandidates = await this.db
      .select({
        id: submissions.id,
        name: submissions.name,
        tagline: submissions.tagline,
        eventId: teams.eventId,
        eventName: events.name,
        galleryVisibility: events.galleryVisibility,
      })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .innerJoin(events, eq(events.id, teams.eventId))
      .where(
        and(
          eq(submissions.status, SUBMISSION_STATUS.SUBMITTED),
          or(
            ilike(submissions.name, term),
            ilike(submissions.tagline, term),
            ilike(submissions.description, term),
          )!,
        ),
      )
      .limit(SAFETY_FETCH_CAP);

    const visibleSubmissions = naturalSortBy(
      submissionCandidates.filter((s) => {
        const isPrivileged = ownedEventIds.has(s.eventId);
        if (s.galleryVisibility === GALLERY_VISIBILITY.HIDDEN) {
          return isPrivileged;
        }
        if (s.galleryVisibility === GALLERY_VISIBILITY.PARTICIPANTS_ONLY) {
          return !!currentUser || isPrivileged;
        }
        return true;
      }),
      (s) => s.name,
    );
    const submissionResults = visibleSubmissions
      .slice(0, limit)
      .map(({ galleryVisibility: _galleryVisibility, ...rest }) => rest);
    // Best-effort: true whenever the filtered set already exceeds the cap.
    // Can under-report if visible matches exist past SAFETY_FETCH_CAP
    // candidates fetched — same boundary the overfetch itself accepts.
    const submissionsHasMore = visibleSubmissions.length > limit;

    // People — name or email. Matching email too (not just name) is what
    // makes finding someone by the identifier you actually have for them
    // (an invite, an @-handle) work, not just a lucky substring of their
    // display name. Safe to include now that this block is signed-in only
    // (below): an anonymous caller can no longer use this to enumerate the
    // instance's emails, which is exactly why it's gated at all. Whatever
    // profile fields exist beyond name/email are still gated by the
    // profile's own visibility settings once the caller opens it. Unlike
    // events/submissions, there's no per-row visibility rule to reuse here
    // — every user matches or doesn't.
    let userResults: { id: string; name: string }[] = [];
    let usersHasMore = false;
    if (currentUser) {
      const userCandidates = await this.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(or(ilike(user.name, term), ilike(user.email, term)))
        .limit(SAFETY_FETCH_CAP);
      const sortedUsers = naturalSortBy(userCandidates, (u) => u.name);
      userResults = sortedUsers.slice(0, limit);
      usersHasMore = sortedUsers.length > limit;
    }

    return {
      events: eventResults,
      eventsHasMore,
      submissions: submissionResults,
      submissionsHasMore,
      users: userResults,
      usersHasMore,
    };
  }
}
