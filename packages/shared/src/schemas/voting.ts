import { z } from "zod";

// FR-VOTE
export const CastVoteInput = z.object({
  submissionId: z.string().uuid(),
  votes: z.number().int().min(1).default(1),
});
export type CastVoteInput = z.infer<typeof CastVoteInput>;

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(2000),
});
export type CreateCommentInput = z.infer<typeof CreateCommentInput>;

export const Comment = z.object({
  id: z.string().uuid(),
  submissionId: z.string().uuid(),
  authorLabel: z.string(),
  authorUserId: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type Comment = z.infer<typeof Comment>;
