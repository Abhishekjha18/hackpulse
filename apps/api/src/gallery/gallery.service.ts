import type { CurrentUser } from "@hackpulse/shared";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { isEventOrganizer } from "../common/auth/is-event-organizer";
import type { Database } from "../db/client";
import { events, submissions, teams } from "../db/schema";
import { DB } from "../db/tokens";
import { isEventVisible } from "../events/events.service";
import { decodeCursor, encodeCursor } from "./cursor";

export interface GalleryQuery {
  search?: string;
  track?: string;
  tag?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class GalleryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // FR-GAL-01/02/03
  async list(eventId: string, query: GalleryQuery, currentUser: CurrentUser | null) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const isPrivileged = isEventOrganizer(currentUser, eventId);

    // Found live: a still-draft event (or an automatic-mode one whose
    // registrationOpenAt hasn't passed yet) is supposed to be invisible to
    // everyone but a role-holder (same rule EventsService.findOne
    // enforces) — but this endpoint only ever checked galleryVisibility,
    // never whether the event itself was visible at all. An organizer
    // setting galleryVisibility to "open" ahead of launch (a reasonable
    // thing to prep in advance) would leak the event's existence and its
    // submissions to anyone who guessed or was sent the eventId. 404, not
    // 403, matching findOne's own reasoning: existence is itself
    // information a caller without a role isn't entitled to.
    if (!isEventVisible(event) && !isPrivileged) {
      throw new NotFoundException();
    }

    if (event.galleryVisibility === "hidden" && !isPrivileged) {
      throw new ForbiddenException();
    }
    if (event.galleryVisibility === "participants_only" && !currentUser && !isPrivileged) {
      throw new ForbiddenException();
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor = decodeCursor(query.cursor);

    const conditions = [eq(teams.eventId, eventId), eq(submissions.status, "submitted")];

    if (query.track) {
      conditions.push(eq(submissions.trackId, query.track));
    }
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(
          ilike(submissions.name, term),
          ilike(submissions.tagline, term),
          ilike(submissions.description, term),
        )!,
      );
    }
    if (query.tag) {
      conditions.push(sql`${submissions.techTags} @> ${JSON.stringify([query.tag])}::jsonb`);
    }
    if (cursor) {
      conditions.push(
        sql`(${submissions.updatedAt}, ${submissions.id}) < (${cursor.updatedAt}::timestamptz, ${cursor.id})`,
      );
    }

    const rows = await this.db
      .select({ submission: submissions })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(and(...conditions))
      .orderBy(desc(submissions.updatedAt), desc(submissions.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    // contentHash is an internal duplicate-detection fingerprint
    // (findDuplicates(), organizer-only) with no reason to reach a gallery
    // viewer, so it's stripped unconditionally here rather than branching
    // on privilege the way the single-submission GET does.
    const items = rows
      .slice(0, limit)
      .map(({ submission: { contentHash: _contentHash, ...rest } }) => rest);
    const last = rows.slice(0, limit).at(-1)?.submission;

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
          : null,
    };
  }

  // FR-WIDGET-01: an embed has no viewer identity to check, so it only
  // ever renders for a fully public ("open") gallery, never
  // "participants_only" (there's no participant to authenticate as an
  // anonymous iframe embed) or "hidden".
  async listForWidget(eventId: string, opts: { track?: string; limit: number }) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    // Same gap fixed above in list(): an embed has no viewer identity to
    // check privilege against at all, so a draft (or not-yet-open
    // automatic-mode) event's widget must be unavailable outright, same as
    // any other non-"open" gallery — never leaked just because someone has
    // (or guesses) the iframe URL. ForbiddenException here, not
    // NotFoundException, so the controller's existing catch renders the
    // friendly "widget unavailable" HTML instead of a raw JSON 404 inside
    // someone else's iframe.
    if (!isEventVisible(event)) {
      throw new ForbiddenException();
    }
    if (event.galleryVisibility !== "open") {
      throw new ForbiddenException();
    }

    const limit = Math.min(Math.max(opts.limit, 1), 24);
    const conditions = [eq(teams.eventId, eventId), eq(submissions.status, "submitted")];
    if (opts.track) {
      conditions.push(eq(submissions.trackId, opts.track));
    }

    const rows = await this.db
      .select({ submission: submissions })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(and(...conditions))
      .orderBy(desc(submissions.updatedAt))
      .limit(limit);

    return { items: rows.map((r) => r.submission), eventName: event.name };
  }
}
