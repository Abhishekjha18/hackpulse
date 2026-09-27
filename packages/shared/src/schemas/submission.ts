import { z } from "zod";

import { httpUrl } from "../common";

export const SubmissionStatus = z.enum(["draft", "submitted"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

// FR-SUB: the stable submission field set (name, tagline, long description,
// thumbnail, gallery, demo video, repo, live link, tech tags, track, plus
// custom questions).
export const Submission = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  trackId: z.string().uuid(),
  name: z.string().min(1),
  tagline: z.string().default(""),
  description: z.string().default(""),
  thumbnailUrl: httpUrl().nullable(),
  galleryImageUrls: z.array(httpUrl()).default([]),
  demoVideoUrl: httpUrl().nullable(),
  repoUrl: httpUrl().nullable(),
  liveUrl: httpUrl().nullable(),
  techTags: z.array(z.string()).default([]),
  status: SubmissionStatus,
  submittedAt: z.string().datetime().nullable(),
});
export type Submission = z.infer<typeof Submission>;

export const CreateSubmissionInput = Submission.omit({
  id: true,
  teamId: true,
  status: true,
  submittedAt: true,
}).partial({
  tagline: true,
  description: true,
  thumbnailUrl: true,
  galleryImageUrls: true,
  demoVideoUrl: true,
  repoUrl: true,
  liveUrl: true,
  techTags: true,
});
export type CreateSubmissionInput = z.infer<typeof CreateSubmissionInput>;

// FR-SUB-02: draft edits, everything but the track is mutable up to the
// deadline; the track is fixed at creation since it determines the rubric.
export const UpdateSubmissionInput = CreateSubmissionInput.omit({ trackId: true }).partial();
export type UpdateSubmissionInput = z.infer<typeof UpdateSubmissionInput>;

// FR-SUB-01: answers to the event's/track's custom questions. `value`'s
// shape depends on the question's type (string for text/url, number for
// number, string[] for multi_select), left unvalidated here and checked
// server-side, since the question's type lives in the DB, not this schema.
export const SetCustomAnswersInput = z.object({
  answers: z.array(
    z.object({
      customQuestionId: z.string().uuid(),
      value: z.unknown(),
    }),
  ),
});
export type SetCustomAnswersInput = z.infer<typeof SetCustomAnswersInput>;

export const CustomAnswer = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  customQuestionId: z.string().uuid(),
  value: z.unknown(),
});
export type CustomAnswer = z.infer<typeof CustomAnswer>;
