import { z } from "zod";

import { httpUrl } from "../common";

export const EventStatus = z.enum([
  "draft",
  "registration_open",
  "submissions_open",
  "judging",
  "results_published",
  "archived",
]);
export type EventStatus = z.infer<typeof EventStatus>;

export const GalleryVisibility = z.enum(["open", "participants_only", "hidden"]);
export const VotingMode = z.enum(["disabled", "single_vote", "quadratic"]);
export const VotingAccess = z.enum(["open_link", "email_gated", "authenticated"]);
export const ScoringMode = z.enum(["rubric", "pairwise"]);

export const Event = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  bannerImageUrl: httpUrl().nullable().default(null),
  timezone: z.string(),
  // Two lifecycle modes (requested explicitly): "automatic" has all six of
  // these set and status computed from the clock; "manual" has all six
  // null and an organizer drives status by hand. Never a mix of the two —
  // enforced by a DB check constraint and by EventsService on every
  // create/update, since a zod .refine() here would block CreateEventInput
  // and UpdateEventInput from deriving via .omit()/.partial() below.
  registrationOpenAt: z.string().datetime().nullable(),
  registrationCloseAt: z.string().datetime().nullable(),
  submissionOpenAt: z.string().datetime().nullable(),
  submissionCloseAt: z.string().datetime().nullable(),
  judgingOpenAt: z.string().datetime().nullable(),
  judgingCloseAt: z.string().datetime().nullable(),
  resultsPublishAt: z.string().datetime().nullable(),
  status: EventStatus,
  // Computed fresh on every read from `status` and the window timestamps
  // (see EventsService.computeDisplayStatus), not stored or client-supplied.
  // This is what the UI should render; `status` itself can drift stale for
  // the three in-between values since nothing forces an organizer to update it.
  displayStatus: EventStatus,
  galleryVisibility: GalleryVisibility,
  votingMode: VotingMode,
  votingAccess: VotingAccess,
  scoringMode: ScoringMode,
  maxTeamSize: z.number().int().min(1).max(4),
});
export type Event = z.infer<typeof Event>;

export const CreateEventInput = Event.omit({ id: true, status: true, displayStatus: true })
  .extend({
    status: EventStatus.default("draft"),
    galleryVisibility: GalleryVisibility.default("hidden"),
    votingMode: VotingMode.default("disabled"),
    votingAccess: VotingAccess.default("authenticated"),
    scoringMode: ScoringMode.default("rubric"),
    // Omitted entirely (not just passed as null) is how a caller picks
    // manual mode — see the Event.registrationOpenAt comment above.
    registrationOpenAt: z.string().datetime().nullable().default(null),
    registrationCloseAt: z.string().datetime().nullable().default(null),
    submissionOpenAt: z.string().datetime().nullable().default(null),
    submissionCloseAt: z.string().datetime().nullable().default(null),
    judgingOpenAt: z.string().datetime().nullable().default(null),
    judgingCloseAt: z.string().datetime().nullable().default(null),
    resultsPublishAt: z.string().datetime().nullable().default(null),
    maxTeamSize: z.number().int().min(1).max(4).default(4),
  })
  .partial({
    galleryVisibility: true,
    votingMode: true,
    votingAccess: true,
    scoringMode: true,
    registrationOpenAt: true,
    registrationCloseAt: true,
    submissionOpenAt: true,
    submissionCloseAt: true,
    judgingOpenAt: true,
    judgingCloseAt: true,
    resultsPublishAt: true,
    maxTeamSize: true,
    bannerImageUrl: true,
  });
export type CreateEventInput = z.infer<typeof CreateEventInput>;

// FR-EVT-03: structural-change constraints — a caller may never move a
// deadline that has already passed, and may never change status backwards
// once judging has started. Enforced in EventsService, not just narrowed
// here, but narrowing the shape here keeps the API from even accepting an
// id/slug rewrite through the update path.
export const UpdateEventInput = CreateEventInput.omit({ slug: true }).partial();
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;

export const Track = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(""),
});
export type Track = z.infer<typeof Track>;

export const CreateTrackInput = Track.omit({ id: true, eventId: true });
export type CreateTrackInput = z.infer<typeof CreateTrackInput>;

// FR-EVT-01 — configurable per event, optionally scoped to one track
// (event-wide when trackId is null). winnerCount: requested explicitly,
// after finding the system silently assumed exactly one winner per prize
// — how many ranked entries within this prize's scope (that track's rank,
// or the event's overall rank if trackId is null) actually win it, e.g.
// "top 3 in AI/ML" or "top 3 overall" for a single-track event.
export const CreatePrizeInput = z.object({
  trackId: z.string().uuid().nullable().default(null),
  name: z.string().min(1),
  description: z.string().default(""),
  winnerCount: z.number().int().min(1).default(1),
});
export type CreatePrizeInput = z.infer<typeof CreatePrizeInput>;

export const UpdatePrizeInput = CreatePrizeInput.partial();
export type UpdatePrizeInput = z.infer<typeof UpdatePrizeInput>;

export const Prize = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  trackId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string(),
  winnerCount: z.number().int(),
});
export type Prize = z.infer<typeof Prize>;

// FR-SUB-01 — organizer-defined custom questions, scoped event-wide
// (trackId null) or to one track.
export const CustomQuestionType = z.enum([
  "text",
  "long_text",
  "url",
  "number",
  "single_select",
  "multi_select",
]);
export type CustomQuestionType = z.infer<typeof CustomQuestionType>;

export const CreateCustomQuestionInput = z
  .object({
    trackId: z.string().uuid().nullable().default(null),
    label: z.string().min(1),
    type: CustomQuestionType,
    options: z.array(z.string().min(1)).nullable().default(null),
    required: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.type === "single_select" || v.type === "multi_select"
        ? !!v.options && v.options.length > 0
        : true,
    { message: "options is required for single_select/multi_select questions", path: ["options"] },
  );
export type CreateCustomQuestionInput = z.infer<typeof CreateCustomQuestionInput>;

export const CustomQuestion = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  trackId: z.string().uuid().nullable(),
  label: z.string(),
  type: CustomQuestionType,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  sortOrder: z.number().int(),
});
export type CustomQuestion = z.infer<typeof CustomQuestion>;
