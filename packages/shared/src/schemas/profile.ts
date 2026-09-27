import { z } from "zod";

import { httpUrl } from "../common";

// Every field a profile can carry, and therefore every field a user can
// individually opt out of showing to other users. Order here is the
// display order the frontend renders fields in.
export const PROFILE_FIELDS = [
  "bio",
  "workplace",
  "skills",
  "githubUrl",
  "linkedinUrl",
  "websiteUrl",
] as const;
export const ProfileField = z.enum(PROFILE_FIELDS);
export type ProfileField = z.infer<typeof ProfileField>;

// The owner's (or an admin's) full view: every field, regardless of
// visibility settings.
export const Profile = z.object({
  userId: z.string(),
  bio: z.string(),
  workplace: z.string(),
  skills: z.array(z.string()),
  githubUrl: httpUrl().nullable(),
  linkedinUrl: httpUrl().nullable(),
  websiteUrl: httpUrl().nullable(),
  visibleFields: z.array(ProfileField),
});
export type Profile = z.infer<typeof Profile>;

export const UpdateProfileInput = z.object({
  bio: z.string().max(2000).optional(),
  workplace: z.string().max(200).optional(),
  skills: z.array(z.string().min(1).max(50)).max(30).optional(),
  githubUrl: httpUrl().nullable().optional(),
  linkedinUrl: httpUrl().nullable().optional(),
  websiteUrl: httpUrl().nullable().optional(),
  visibleFields: z.array(ProfileField).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

// What a non-owner, non-admin caller gets back: name is always present
// (needed just to identify whose profile this is, same posture as a
// team member's name elsewhere in this app), every other field is
// present only if its owner opted it into visibleFields.
export const PublicProfile = z.object({
  userId: z.string(),
  name: z.string(),
  bio: z.string().optional(),
  workplace: z.string().optional(),
  skills: z.array(z.string()).optional(),
  githubUrl: httpUrl().nullable().optional(),
  linkedinUrl: httpUrl().nullable().optional(),
  websiteUrl: httpUrl().nullable().optional(),
  // Only ever populated when the *requester* is an admin viewing someone
  // else's profile: this is where an admin sees/grants organizer access,
  // never returned to a non-admin viewer (including the profile's own owner).
  isAdmin: z.boolean().optional(),
  canOrganizeEvents: z.boolean().optional(),
});

export const SetOrganizerStatusInput = z.object({
  canOrganizeEvents: z.boolean(),
});
export type SetOrganizerStatusInput = z.infer<typeof SetOrganizerStatusInput>;
export type PublicProfile = z.infer<typeof PublicProfile>;
