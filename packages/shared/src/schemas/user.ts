import { z } from "zod";

import { EVENT_ROLE } from "../constants";
export const EventRole = z.enum([EVENT_ROLE.ORGANIZER, EVENT_ROLE.JUDGE]);
export type EventRole = z.infer<typeof EventRole>;

export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  locale: z.string().default("en"),
  timezone: z.string(),
  isAdmin: z.boolean().default(false),
  // Site-wide "may create/organize events" capability, independent of
  // isAdmin (which also satisfies it) and independent of any per-event
  // eventRoles "organizer" entry (which only applies to events already
  // created). Grantable by an admin to a non-admin user.
  canOrganizeEvents: z.boolean().default(false),
});
export type User = z.infer<typeof User>;

export const RegisterInput = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  name: z.string().min(1),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const CurrentUser = User.extend({
  eventRoles: z.array(
    z.object({
      eventId: z.string().uuid(),
      role: EventRole,
    }),
  ),
});
export type CurrentUser = z.infer<typeof CurrentUser>;
