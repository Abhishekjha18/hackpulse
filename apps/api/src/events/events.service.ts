import {
  type CreateEventInput,
  type CreateTrackInput,
  type CurrentUser,
  ERROR_CODE,
  type EventStatus,
  type UpdateEventInput,
} from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "../db/client";
import {
  eventRoles,
  events,
  judgeAssignments,
  pairwiseComparisons,
  prizes,
  submissions,
  teamMembers,
  teams,
  tracks,
} from "../db/schema";
import { DB } from "../db/tokens";

const DATE_FIELDS = [
  "registrationOpenAt",
  "registrationCloseAt",
  "submissionOpenAt",
  "submissionCloseAt",
  "judgingOpenAt",
  "judgingCloseAt",
  "resultsPublishAt",
] as const;

type DateField = (typeof DATE_FIELDS)[number];

/** The shared schema carries deadlines as ISO strings on the wire (FR-EVT);
 * Drizzle's timestamp columns want Date objects going in. Only the known
 * deadline fields are remapped — every other field passes through as-is. */
function withParsedDates<T extends Partial<Record<DateField, string | null | undefined>>>(
  input: T,
): Omit<T, DateField> & { [K in DateField & keyof T]: Date | null | undefined } {
  const out: Record<string, unknown> = { ...input };
  for (const field of DATE_FIELDS) {
    const value = out[field];
    if (typeof value === "string") {
      out[field] = new Date(value);
    }
  }
  return out as Omit<T, DateField> & { [K in DateField & keyof T]: Date | null | undefined };
}

const LIFECYCLE_DATE_FIELDS = [
  "registrationOpenAt",
  "registrationCloseAt",
  "submissionOpenAt",
  "submissionCloseAt",
  "judgingOpenAt",
  "judgingCloseAt",
] as const;

// Two lifecycle modes, requested explicitly — see the events schema's own
// comment for the full rationale. Derived from whether the six lifecycle
// dates are set, never stored as a separate flag.
type LifecycleMode = "automatic" | "manual";
function lifecycleModeOf(event: { registrationOpenAt: Date | null }): LifecycleMode {
  return event.registrationOpenAt === null ? "manual" : "automatic";
}

// Found live, discussed with the user: the stored `status` only genuinely
// gates public-visibility (draft) and results-visibility (results_published)
// — see FR-EVT-05 — so in automatic mode the three in-between values were
// just an organizer-picked label with nothing keeping it in sync with
// reality. This computes what the UI should actually show instead, fresh on
// every read, from the window timestamps rather than a value someone has to
// remember to update. In manual mode there's nothing to compute — status is
// the direct, organizer-driven truth (see assertValidStatusTransition) — so
// this just passes it through unchanged.
// results_published/archived stay real, manually-triggered terminal states
// in both modes. draft is only a real automatic-mode state until
// registrationOpenAt actually passes — the user asked for this explicitly
// ("even from draft"): once the clock has genuinely started, showing
// "draft" is misleading even if the organizer never flipped it. Visibility
// (isEventVisible/isVisibleCondition below) now follows the same rule —
// requested explicitly, after removing the "make public" button in
// automatic mode entirely: an automatic-mode event goes public on its own
// once registrationOpenAt passes, with no organizer click required, the
// same way displayStatus already advances on its own. The three live
// automatic-mode phases are derived by taking the latest one reached,
// checked newest-first — this assumes the windows are sequential
// (registration ≤ submissions ≤ judging), which assertAutomaticDatesValid
// guarantees on create/update.
export function computeDisplayStatus(event: {
  status: EventStatus;
  registrationOpenAt: Date | null;
  submissionOpenAt: Date | null;
  judgingOpenAt: Date | null;
}): EventStatus {
  if (
    lifecycleModeOf(event) === "manual" ||
    event.status === "results_published" ||
    event.status === "archived"
  ) {
    return event.status;
  }
  // Safe: automatic mode (registrationOpenAt !== null) guarantees
  // submissionOpenAt/judgingOpenAt are also non-null (DB check constraint).
  const submissionOpenAt = event.submissionOpenAt!;
  const judgingOpenAt = event.judgingOpenAt!;
  const now = Date.now();
  if (event.status === "draft" && now < event.registrationOpenAt!.getTime()) {
    return "draft";
  }
  if (now >= judgingOpenAt.getTime()) {
    return "judging";
  }
  if (now >= submissionOpenAt.getTime()) {
    return "submissions_open";
  }
  return "registration_open";
}

// FR-EVT-05/06 — one shared definition of "is this event actually public"
// (draft events are hidden from everyone except a role-holder), used
// everywhere `status !== "draft"` used to be checked directly. An event is
// public once status has moved past draft (a manual action, either mode),
// OR — automatic mode only — once registrationOpenAt has actually passed,
// with no organizer action needed at all: the same "the clock is the
// truth" rule every other automatic-mode gate already follows, and why the
// dashboard's "Make public" button was removed for automatic mode
// specifically (manual mode still needs it — nothing else ever advances a
// manual event's status).
export function isVisibleCondition() {
  return or(
    ne(events.status, "draft"),
    and(isNotNull(events.registrationOpenAt), sql`${events.registrationOpenAt} <= now()`),
  )!;
}
export function isEventVisible(event: {
  status: EventStatus;
  registrationOpenAt: Date | null;
}): boolean {
  return (
    event.status !== "draft" ||
    (event.registrationOpenAt !== null && event.registrationOpenAt.getTime() <= Date.now())
  );
}

type LifecycleDates = Record<(typeof LIFECYCLE_DATE_FIELDS)[number], Date>;

// FR-EVT-01/02 — the six lifecycle dates are either all set (automatic
// mode) or all omitted (manual mode), never a mix; if set, each pair must
// be in the sensible order and the whole thing hasn't started yet.
// Individual date *adjustments* to an already-running automatic event
// (extending a deadline, say) go through here too, minus the "hasn't
// started yet" check, which only makes sense at creation.
function assertAutomaticDatesValid(dates: LifecycleDates, opts: { isCreate: boolean }) {
  if (opts.isCreate && dates.registrationOpenAt <= new Date()) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "registrationOpenAt must be in the future",
      },
    });
  }
  if (dates.registrationOpenAt >= dates.registrationCloseAt) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "registrationCloseAt must be after registrationOpenAt",
      },
    });
  }
  // Found live: nothing enforced this — submissionOpenAt could be set
  // before registrationCloseAt (even before registrationOpenAt) and the
  // event would still create/update successfully. Same >= (not >)
  // convention as judgingOpenAt/submissionCloseAt below: back-to-back
  // phases (registration closes the instant submissions open) are fine,
  // overlapping or reversed ones aren't.
  if (dates.submissionOpenAt < dates.registrationCloseAt) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "submissionOpenAt cannot be before registrationCloseAt",
      },
    });
  }
  if (dates.submissionOpenAt >= dates.submissionCloseAt) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "submissionCloseAt must be after submissionOpenAt",
      },
    });
  }
  if (dates.judgingOpenAt >= dates.judgingCloseAt) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "judgingCloseAt must be after judgingOpenAt",
      },
    });
  }
  // FR-EVT-02 — judging shouldn't be able to start before submissions are
  // done; discussed with the user after finding nothing enforced this
  // ordering (the seed data always had it right, but only by convention).
  if (dates.judgingOpenAt < dates.submissionCloseAt) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: "judgingOpenAt cannot be before submissionCloseAt",
      },
    });
  }
}

// FR-EVT-06 — a lifecycle date that has already passed is a fact of
// history, not a plan: an organizer shouldn't be able to retroactively
// change when registration/submissions/judging actually opened (or
// closed) after people already relied on it. Checked against each
// field's *existing* stored value, not the merged/requested one, since
// what matters is whether that specific phase has itself already
// started — still-future fields stay freely editable (extend or shorten,
// still subject to assertAutomaticDatesValid's ordering rules). Found
// live: an organizer could otherwise edit any of the six dates at any
// time, including registrationOpenAt after registration had already
// begun.
function assertPastDatesUnchanged(existing: LifecycleDates, input: UpdateEventInput, now: Date) {
  for (const field of LIFECYCLE_DATE_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (existing[field] > now) {
      continue;
    }
    if (new Date(raw).getTime() === existing[field].getTime()) {
      continue;
    }
    throw new ConflictException({
      error: {
        code: ERROR_CODE.LIFECYCLE_DATE_LOCKED,
        message: `${field} has already passed and can no longer be changed`,
      },
    });
  }
}

const STATUS_RANK: Record<EventStatus, number> = {
  draft: 0,
  registration_open: 1,
  submissions_open: 2,
  judging: 3,
  results_published: 4,
  archived: 5,
};

// The full manual-mode status state machine, requested explicitly, plus
// the two rules that hold in *either* mode (publish is a dedicated
// endpoint, not a direct status write; archiving requires results already
// published). Automatic-mode events never reach the manual-only branch
// below, since their status can only ever move to "archived" directly.
async function assertValidStatusTransition(
  db: Database,
  existing: { id: string; status: EventStatus; registrationOpenAt: Date | null },
  requestedStatus: EventStatus,
) {
  if (requestedStatus === existing.status) {
    return;
  }
  if (existing.status === "archived") {
    throw new ConflictException({
      error: {
        code: ERROR_CODE.EVENT_ARCHIVED,
        message: "An archived event's status can't be changed",
      },
    });
  }
  if (requestedStatus === "results_published") {
    throw new ConflictException({
      error: {
        code: ERROR_CODE.USE_PUBLISH_ENDPOINT,
        message: "Publish results via POST .../results/publish, not a direct status change",
      },
    });
  }
  if (requestedStatus === "archived") {
    if (existing.status !== "results_published") {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.RESULTS_NOT_PUBLISHED,
          message: "An event can only be archived after its results have been published",
        },
      });
    }
    return;
  }
  if (lifecycleModeOf(existing) === "automatic") {
    // The one deliberate escape from draft: displayStatus already tracks
    // the configured dates automatically, but visibility gates on the
    // *stored* status (FR-EVT-05), and "make this event public" has to
    // stay an explicit organizer decision, the same reasoning that already
    // keeps draft manual for everything else. Whichever of the three live
    // values is picked doesn't matter afterward — displayStatus overrides
    // to the actually-correct one on the very next read regardless.
    const isMakingPublic =
      existing.status === "draft" &&
      (["registration_open", "submissions_open", "judging"] as EventStatus[]).includes(
        requestedStatus,
      );
    if (isMakingPublic) {
      return;
    }
    throw new ConflictException({
      error: {
        code: ERROR_CODE.AUTOMATIC_MODE_STATUS_LOCKED,
        message:
          "This event's status is computed from its configured dates and can't be set directly",
      },
    });
  }
  // Manual mode from here on — block moving backward once real progress
  // exists, so the status label can't misrepresent data that's already in.
  if (STATUS_RANK[requestedStatus] < STATUS_RANK[existing.status]) {
    if (STATUS_RANK[requestedStatus] <= STATUS_RANK.registration_open) {
      const [submitted] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .innerJoin(teams, eq(teams.id, submissions.teamId))
        .where(and(eq(teams.eventId, existing.id), eq(submissions.status, "submitted")))
        .limit(1);
      if (submitted) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.SUBMISSIONS_EXIST,
            message: "Can't move back to registration, submissions already exist",
          },
        });
      }
    }
    if (STATUS_RANK[requestedStatus] <= STATUS_RANK.submissions_open) {
      const [scored] = await db
        .select({ id: judgeAssignments.id })
        .from(judgeAssignments)
        .where(
          and(eq(judgeAssignments.eventId, existing.id), eq(judgeAssignments.status, "completed")),
        )
        .limit(1);
      const [compared] = await db
        .select({ id: pairwiseComparisons.id })
        .from(pairwiseComparisons)
        .where(eq(pairwiseComparisons.eventId, existing.id))
        .limit(1);
      if (scored || compared) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.JUDGING_STARTED,
            message: "Can't move back, judging has already started",
          },
        });
      }
    }
    return;
  }
  // Requested explicitly: a forward move must land on the very next status
  // in the sequence (draft -> registration_open -> submissions_open ->
  // judging) — no skipping ahead, from the UI or a direct API call. Only
  // reachable here with a forward move (backward already returned above);
  // results_published/archived are handled by their own branches earlier
  // and never reach this point.
  if (STATUS_RANK[requestedStatus] !== STATUS_RANK[existing.status] + 1) {
    throw new ConflictException({
      error: {
        code: ERROR_CODE.STATUS_MUST_BE_SEQUENTIAL,
        message: `Status can only move forward one step at a time. From "${existing.status}" the next status is the only valid target.`,
      },
    });
  }
}

@Injectable()
export class EventsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // FR-EVT-01 — creator becomes organizer, atomically with event creation.
  // Found live: this had no role check at all — any registered user could
  // create an event (and so become its organizer). Event-organizing is now
  // restricted to admins and users an admin has specifically authorized
  // (currentUser.canOrganizeEvents) — everyone else registers as a plain
  // participant by default, per the intended role model.
  async create(input: CreateEventInput, currentUser: CurrentUser) {
    if (!currentUser.isAdmin && !currentUser.canOrganizeEvents) {
      throw new ForbiddenException({
        error: {
          code: ERROR_CODE.NOT_AUTHORIZED_TO_ORGANIZE,
          message:
            "You don't have permission to create events. Ask an admin to grant you organizer access.",
        },
      });
    }

    const providedDates = LIFECYCLE_DATE_FIELDS.map((f) => input[f]);
    const providedCount = providedDates.filter((v) => v !== null && v !== undefined).length;
    if (providedCount !== 0 && providedCount !== LIFECYCLE_DATE_FIELDS.length) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message:
            "registrationOpenAt/CloseAt, submissionOpenAt/CloseAt, and judgingOpenAt/CloseAt must all be provided together (automatic mode) or all omitted (manual mode)",
        },
      });
    }
    if (providedCount === LIFECYCLE_DATE_FIELDS.length) {
      const dates = Object.fromEntries(
        LIFECYCLE_DATE_FIELDS.map((f) => [f, new Date(input[f]!)]),
      ) as LifecycleDates;
      assertAutomaticDatesValid(dates, { isCreate: true });
    }

    // Every event starts as a hidden draft, in either mode — see the
    // "make public" exception in assertValidStatusTransition for how an
    // organizer takes it out of draft afterward. Ignores whatever status
    // the request body asked for; there's no legitimate reason to create
    // an event anywhere but the very start of its own lifecycle.
    const ownerUserId = currentUser.id;
    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          ...withParsedDates(input),
          status: "draft",
          ownerUserId,
        } as typeof events.$inferInsert)
        .returning();

      await tx.insert(eventRoles).values({
        eventId: event.id,
        userId: ownerUserId,
        role: "organizer",
      });

      return { ...event, displayStatus: computeDisplayStatus(event) };
    });
  }

  // FR-GAL-03 / FR-EVT — a draft event is visible only to a caller holding
  // a role on it (or a global admin); anything past draft is publicly
  // listed. Filtered in SQL, not fetched-then-discarded.
  // Cursor-paginated like every other list endpoint (API-DESIGN.md §1) —
  // {items, nextCursor}, not a bare array. Found inconsistent (a bare
  // array) by the frontend's first real fetch against it, which is exactly
  // the kind of contract mismatch a live integration catches that a
  // type-level check on either side alone wouldn't.
  async list(
    currentUser: CurrentUser | null,
    opts: {
      cursor?: string;
      limit?: number;
      phase?: "active" | "past" | "mine";
      search?: string;
    } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

    // "mine" has no meaning for an anonymous caller — matches the same
    // posture as every other /mine-style endpoint in this app (empty,
    // not an error).
    if (opts.phase === "mine" && !currentUser) {
      return { items: [], nextCursor: null };
    }

    const conditions = [];
    // isAdmin no longer exempts this filter — an admin sees other
    // organizers' drafts in this list only if they actually hold a role on
    // that specific event, exactly like anyone else. ownedEventIds already
    // comes from currentUser.eventRoles regardless of admin status, so this
    // is the same filter for every signed-in user, admin or not.
    {
      const ownedEventIds = currentUser?.eventRoles.map((r) => r.eventId) ?? [];
      conditions.push(
        ownedEventIds.length > 0
          ? or(isVisibleCondition(), inArray(events.id, ownedEventIds))!
          : isVisibleCondition(),
      );
    }
    // Homepage active/past split. Requested explicitly: an event only
    // belongs in "past" once an organizer has actually archived it —
    // never as a side effect of the clock or of status merely reaching
    // judging/results_published. This used to be timestamp-driven for
    // automatic-mode events (submissionCloseAt + 24h vs now()) and
    // status-list-driven for manual-mode ones, which had two problems:
    // first, a manual event with submissionCloseAt permanently null hit
    // `NULL + interval > now()` evaluating to NULL, which a WHERE clause
    // treats as "exclude this row" — invisible in both tabs regardless of
    // status. Second, even after that was fixed, an event judged or even
    // results_published was still being called "past" on its own, with no
    // organizer action — not what was wanted. `archived` is reachable in
    // both lifecycle modes only via an explicit, one-directional organizer
    // action (assertValidStatusTransition requires results_published
    // first), so it alone is both modes' honest "past" signal.
    if (opts.phase === "active") {
      conditions.push(ne(events.status, "archived"));
    } else if (opts.phase === "past") {
      conditions.push(eq(events.status, "archived"));
    } else if (opts.phase === "mine" && currentUser) {
      // "Mine" = organizer or judge (eventRoles) OR a team member on the
      // event (teamMembers carries no role of its own — a participant's
      // only trace of standing on an event is their team membership).
      const roleEventIds = currentUser.eventRoles.map((r) => r.eventId);
      const teamEventRows = await this.db
        .select({ eventId: teams.eventId })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(eq(teamMembers.userId, currentUser.id));
      const allIds = [...new Set([...roleEventIds, ...teamEventRows.map((r) => r.eventId)])];
      conditions.push(allIds.length > 0 ? inArray(events.id, allIds) : sql`false`);
    }
    if (opts.search) {
      const term = `%${opts.search}%`;
      conditions.push(or(ilike(events.name, term), ilike(events.description, term))!);
    }
    if (opts.cursor) {
      const [createdAt, id] = Buffer.from(opts.cursor, "base64url").toString("utf8").split("|");
      if (createdAt && id) {
        conditions.push(
          sql`(${events.createdAt}, ${events.id}) < (${createdAt}::timestamptz, ${id})`,
        );
      }
    }

    const rows = await this.db
      .select()
      .from(events)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(events.createdAt), desc(events.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`, "utf8").toString("base64url")
        : null;

    // Homepage summary badges (submission count, top prize names) —
    // batched over the page's event ids rather than a correlated
    // subquery per row, same "aggregate in process" posture the judging
    // progress dashboard already uses at this data scale.
    const eventIds = items.map((e) => e.id);
    const [submissionCountRows, prizeRows] = eventIds.length
      ? await Promise.all([
          this.db
            .select({ eventId: teams.eventId, value: count() })
            .from(submissions)
            .innerJoin(teams, eq(teams.id, submissions.teamId))
            .where(and(inArray(teams.eventId, eventIds), eq(submissions.status, "submitted")))
            .groupBy(teams.eventId),
          this.db
            .select({ eventId: prizes.eventId, name: prizes.name })
            .from(prizes)
            .where(inArray(prizes.eventId, eventIds)),
        ])
      : [[], []];

    const submissionCountByEvent = new Map(submissionCountRows.map((r) => [r.eventId, r.value]));
    const prizeNamesByEvent = new Map<string, string[]>();
    for (const p of prizeRows) {
      const list = prizeNamesByEvent.get(p.eventId) ?? [];
      if (list.length < 2) {
        list.push(p.name);
      }
      prizeNamesByEvent.set(p.eventId, list);
    }

    const itemsWithSummary = items.map((e) => ({
      ...e,
      displayStatus: computeDisplayStatus(e),
      submissionCount: submissionCountByEvent.get(e.id) ?? 0,
      prizeNames: prizeNamesByEvent.get(e.id) ?? [],
    }));

    return { items: itemsWithSummary, nextCursor };
  }

  // Backs the homepage's real-data stat block — deliberately public and
  // deliberately just aggregate counts, nothing that could leak anything
  // about a specific event, submission, or user. Draft events are
  // excluded from every count for the same reason the public event list
  // excludes them: an organizer's not-yet-announced event isn't
  // "instance activity" a visitor should see evidence of. Every count
  // here is instance-wide — every event regardless of phase, active or
  // archived, not just the currently-active ones — since a completed
  // hackathon's history is exactly the kind of evidence a prospective
  // organizer or judge is looking for.
  async getInstanceStats() {
    const [
      [{ value: eventCount }],
      [{ value: submissionCount }],
      [{ value: judgeCount }],
      [{ value: teamCount }],
      [{ value: participantCount }],
    ] = await Promise.all([
      this.db.select({ value: count() }).from(events).where(isVisibleCondition()),
      this.db
        .select({ value: count() })
        .from(submissions)
        .innerJoin(teams, eq(teams.id, submissions.teamId))
        .innerJoin(events, eq(events.id, teams.eventId))
        .where(and(eq(submissions.status, "submitted"), isVisibleCondition())),
      this.db
        .select({ value: countDistinct(eventRoles.userId) })
        .from(eventRoles)
        .innerJoin(events, eq(events.id, eventRoles.eventId))
        .where(and(eq(eventRoles.role, "judge"), isVisibleCondition())),
      this.db
        .select({ value: count() })
        .from(teams)
        .innerJoin(events, eq(events.id, teams.eventId))
        .where(isVisibleCondition()),
      this.db
        .select({ value: countDistinct(teamMembers.userId) })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .innerJoin(events, eq(events.id, teams.eventId))
        .where(isVisibleCondition()),
    ]);
    return { eventCount, submissionCount, judgeCount, teamCount, participantCount };
  }

  async findOne(eventId: string, currentUser: CurrentUser | null) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    // Not isEventOrganizer here on purpose — a judge holds a role on this
    // event too and should be able to see its own draft, not just its
    // organizer. isAdmin no longer bypasses this either way.
    const visible =
      isEventVisible(event) || currentUser?.eventRoles.some((r) => r.eventId === eventId);

    // A draft event a caller can't see returns 404, not 403 — its
    // existence is itself information the caller isn't entitled to.
    if (!visible) {
      throw new NotFoundException();
    }

    return { ...event, displayStatus: computeDisplayStatus(event) };
  }

  // FR-EVT-03 — structural changes are constrained so they can't
  // retroactively invalidate submissions already accepted in good faith.
  async update(eventId: string, input: UpdateEventInput) {
    const [existing] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!existing) {
      throw new NotFoundException();
    }

    // Mode-lock, requested explicitly: once created with dates (automatic)
    // or without them (manual), an event can't switch — letting it switch
    // mid-lifecycle is exactly the edge case this constraint,
    // computeDisplayStatus, and assertValidStatusTransition all assume
    // away.
    const existingMode = lifecycleModeOf(existing);
    const touchesLifecycleDates = LIFECYCLE_DATE_FIELDS.some((f) => input[f] !== undefined);
    if (touchesLifecycleDates) {
      const wouldGoAutomatic = LIFECYCLE_DATE_FIELDS.some(
        (f) => input[f] !== null && input[f] !== undefined,
      );
      if (existingMode === "manual" && wouldGoAutomatic) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.LIFECYCLE_MODE_LOCKED,
            message:
              "This event has no configured dates (manual mode) and can't switch to automatic mode",
          },
        });
      }
      if (existingMode === "automatic" && !wouldGoAutomatic) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.LIFECYCLE_MODE_LOCKED,
            message:
              "This event has configured dates (automatic mode) and can't switch to manual mode",
          },
        });
      }
    }

    if (existingMode === "automatic") {
      // Safe to assert non-null throughout this branch: automatic mode
      // guarantees all six are set (DB check constraint).
      const existingDates = Object.fromEntries(
        LIFECYCLE_DATE_FIELDS.map((f) => [f, existing[f]!]),
      ) as LifecycleDates;
      assertPastDatesUnchanged(existingDates, input, new Date());

      if (input.submissionCloseAt) {
        const newClose = new Date(input.submissionCloseAt);
        const [latest] = await this.db
          .select({ submittedAt: submissions.submittedAt })
          .from(submissions)
          .innerJoin(teams, eq(teams.id, submissions.teamId))
          .where(and(eq(teams.eventId, eventId), isNotNull(submissions.submittedAt)))
          .orderBy(desc(submissions.submittedAt))
          .limit(1);

        if (latest?.submittedAt && newClose < latest.submittedAt) {
          throw new ConflictException({
            error: {
              code: ERROR_CODE.CONFLICT,
              message:
                "submissionCloseAt cannot move earlier than the most recent accepted submission",
            },
          });
        }
      }

      // Validated against the resulting state, not just the input in
      // isolation — an update might only touch one of the six fields, so
      // whichever wasn't supplied falls back to its existing stored value.
      const mergedDates = Object.fromEntries(
        LIFECYCLE_DATE_FIELDS.map((f) => [f, input[f] ? new Date(input[f]!) : existing[f]!]),
      ) as LifecycleDates;
      assertAutomaticDatesValid(mergedDates, { isCreate: false });
    }

    if (input.status !== undefined) {
      await assertValidStatusTransition(this.db, existing, input.status);
    }

    const [updated] = await this.db
      .update(events)
      .set({
        ...withParsedDates(input),
        updatedAt: new Date(),
      } as Partial<typeof events.$inferInsert>)
      .where(eq(events.id, eventId))
      .returning();

    return { ...updated, displayStatus: computeDisplayStatus(updated) };
  }

  // Public — a participant needs to see track options before choosing one
  // when creating a submission, same as they'd see the gallery.
  async listTracks(eventId: string) {
    return this.db.select().from(tracks).where(eq(tracks.eventId, eventId));
  }

  async createTrack(eventId: string, input: CreateTrackInput) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const [track] = await this.db
      .insert(tracks)
      .values({ ...input, eventId })
      .returning();

    return track;
  }

  // Deleting a track cascades to its submissions, prizes, and rubrics
  // (FK onDelete: cascade) — too destructive to allow once anyone has
  // actually submitted into it, so that case is blocked outright rather
  // than left to silently wipe data.
  async deleteTrack(eventId: string, trackId: string) {
    const [track] = await this.db
      .select()
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.eventId, eventId)));
    if (!track) {
      throw new NotFoundException();
    }

    const [submission] = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.trackId, trackId))
      .limit(1);
    if (submission) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.CONFLICT,
          message: "This track has submissions in it and can't be deleted",
        },
      });
    }

    await this.db.delete(tracks).where(eq(tracks.id, trackId));
  }
}
