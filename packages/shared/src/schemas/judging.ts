import { z } from "zod";

import { INVITE_STATUS } from "../constants";
import { EventRole } from "./user";

// FR-JASSIGN-01
export const InviteJudgeInput = z.object({
  email: z.string().email(),
  trackIds: z.array(z.string().uuid()).min(1),
});
export type InviteJudgeInput = z.infer<typeof InviteJudgeInput>;

export const JudgeInviteStatus = z.enum([
  INVITE_STATUS.PENDING,
  INVITE_STATUS.ACCEPTED,
  INVITE_STATUS.DECLINED,
]);
export type JudgeInviteStatus = z.infer<typeof JudgeInviteStatus>;

// POST /events/:eventId/judges/self: an organizer judging their own event.
// Grants the role directly, no invite/accept round trip, since clicking
// this on their own dashboard already is their consent.
export const SelfJudgeInput = z.object({
  trackIds: z.array(z.string().uuid()).min(1),
});
export type SelfJudgeInput = z.infer<typeof SelfJudgeInput>;

// POST /events/:eventId/organizers — inviting a co-organizer. No trackIds:
// organizing isn't track-scoped, unlike judging.
export const InviteCoOrganizerInput = z.object({
  email: z.string().email(),
});
export type InviteCoOrganizerInput = z.infer<typeof InviteCoOrganizerInput>;

// GET /events/:eventId/judges and /organizers: accepted role-holders plus
// unresolved/declined invites for that role, in one list, so a dashboard
// tab can show who hasn't responded yet. Shared shape, backed by
// EventRoleInvitesService.listForEvent, filtered by role.
export const EventRoleListEntry = z.object({
  // eventRoleId for an accepted holder; for a pending/declined invite with
  // no eventRoles row yet, the event_invites row's id instead.
  id: z.string().uuid(),
  inviteId: z.string().uuid().nullable(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: EventRole,
  status: JudgeInviteStatus,
  tracks: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type EventRoleListEntry = z.infer<typeof EventRoleListEntry>;

// GET /users/me/event-invites — what the notifications bell polls. One
// list covering both judge and co-organizer invites, tagged by role.
export const MyEventInvite = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  eventName: z.string(),
  role: EventRole,
  trackNames: z.array(z.string()),
  invitedByName: z.string(),
});
export type MyEventInvite = z.infer<typeof MyEventInvite>;

// FR-SCORE-01 — weights are fractions of 1.0 and must sum to it.
export const RubricCriterionInput = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  // numeric(5,4) in the DB: anything finer than 0.0001 is silently rounded
  // on write (0.00001 became 0.0000, a criterion that can never count), so
  // the sum validated would not be the sum stored. Reject it up front.
  weight: z
    .number()
    .min(0.0001)
    .max(1)
    .refine((w) => Math.abs(w * 10000 - Math.round(w * 10000)) < 1e-6, {
      message: "weight can have at most 4 decimal places",
    }),
});
export type RubricCriterionInput = z.infer<typeof RubricCriterionInput>;

export const CreateRubricInput = z
  .object({
    name: z.string().min(1),
    trackId: z.string().uuid().nullable().default(null),
    // Bounded to fit criterion_scores.value's numeric(4,2) column (max
    // 99.99); an unbounded scaleMax previously let an organizer configure
    // a scale a judge's score would overflow, causing a 500 instead of
    // a clean validation error.
    scaleMin: z.number().int().min(0).max(99).default(1),
    scaleMax: z.number().int().min(1).max(99).default(5),
    criteria: z.array(RubricCriterionInput).min(1),
  })
  .refine((v) => v.scaleMax > v.scaleMin, {
    message: "scaleMax must be greater than scaleMin",
    path: ["scaleMax"],
  });
export type CreateRubricInput = z.infer<typeof CreateRubricInput>;

// Output shapes, as returned by the API — distinct from the *Input schemas
// above, which describe what the client sends to create one.
export const RubricCriterion = z.object({
  id: z.string().uuid(),
  rubricId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  weight: z.string(), // numeric(5,4) comes back as a string — see DATA-MODEL.md
  sortOrder: z.number().int(),
});
export type RubricCriterion = z.infer<typeof RubricCriterion>;

export const Rubric = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  trackId: z.string().uuid().nullable(),
  name: z.string(),
  scaleMin: z.number().int(),
  scaleMax: z.number().int(),
  criteria: z.array(RubricCriterion),
});
export type Rubric = z.infer<typeof Rubric>;

// FR-JASSIGN-02
export const CreateAssignmentsInput = z.discriminatedUnion("strategy", [
  z.object({
    strategy: z.literal("manual"),
    submissionIds: z.array(z.string().uuid()).min(1),
    judgeUserIds: z.array(z.string()).min(1),
    // Overrides the conflict-of-interest warning (shared declared
    // workplace) only — never the structural track-scoping rule, which
    // has no override. Absent/false: a conflicted pairing comes back in
    // `skipped` instead of being created.
    force: z.boolean().default(false).optional(),
  }),
  z.object({
    strategy: z.literal("algorithmic"),
    trackId: z.string().uuid(),
    minJudgesPerSubmission: z.number().int().min(1).default(2),
  }),
]);
export type CreateAssignmentsInput = z.infer<typeof CreateAssignmentsInput>;

// FR-SCORE-02
export const CriterionScoreInput = z.object({
  rubricCriterionId: z.string().uuid(),
  value: z.number(),
  feedback: z.string().nullable().optional(),
});
export type CriterionScoreInput = z.infer<typeof CriterionScoreInput>;

export const SaveScoreInput = z.object({
  overallFeedback: z.string().nullable().optional(),
  criterionScores: z.array(CriterionScoreInput).min(1),
});
export type SaveScoreInput = z.infer<typeof SaveScoreInput>;

export const NormalizationMethod = z.enum(["z_score", "min_max"]);
export type NormalizationMethod = z.infer<typeof NormalizationMethod>;

// FR-PAIR
export const PairwiseCompareInput = z.object({
  trackId: z.string().uuid(),
  submissionA: z.string().uuid(),
  submissionB: z.string().uuid(),
  winner: z.enum(["a", "b", "tie"]),
});
export type PairwiseCompareInput = z.infer<typeof PairwiseCompareInput>;
