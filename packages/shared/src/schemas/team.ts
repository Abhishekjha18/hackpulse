import { z } from "zod";

// FR-TEAM
export const Team = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  name: z.string().min(1),
  ownerUserId: z.string(),
  inviteCode: z.string(),
});
export type Team = z.infer<typeof Team>;

export const CreateTeamInput = z.object({
  name: z.string().min(1),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;

export const JoinTeamInput = z.object({
  inviteCode: z.string().min(1),
});
export type JoinTeamInput = z.infer<typeof JoinTeamInput>;

export const TeamMember = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  userId: z.string(),
  joinedAt: z.string().datetime(),
  userName: z.string(),
});
export type TeamMember = z.infer<typeof TeamMember>;
