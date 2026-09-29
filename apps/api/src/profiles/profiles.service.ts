import {
  AUDIT_ACTION,
  type Profile,
  PROFILE_FIELDS,
  type PublicProfile,
  type UpdateProfileInput,
} from "@hackpulse/shared";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import type { Database } from "../db/client";
import { profiles, user } from "../db/schema";
import { DB } from "../db/tokens";

function emptyProfile(userId: string): Profile {
  return {
    userId,
    bio: "",
    workplace: "",
    skills: [],
    githubUrl: null,
    linkedinUrl: null,
    websiteUrl: null,
    visibleFields: [...PROFILE_FIELDS],
  };
}

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // A user who has never touched their profile has no row at all; return
  // the same shape a fresh one would have rather than 404ing, so the
  // owner's own edit form always has something to render.
  async getMine(userId: string): Promise<Profile> {
    const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, userId));
    if (!row) {
      return emptyProfile(userId);
    }
    return row;
  }

  async update(userId: string, input: UpdateProfileInput): Promise<Profile> {
    const [existing] = await this.db.select().from(profiles).where(eq(profiles.userId, userId));
    if (existing) {
      const [updated] = await this.db
        .update(profiles)
        .set(input)
        .where(eq(profiles.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(profiles)
      .values({ userId, ...input })
      .returning();
    return created;
  }

  // A non-owner, non-admin caller only sees fields the owner put in
  // visibleFields; name is the one exception, always shown, since it's
  // needed to identify whose profile this is. A user with no profile row
  // yet still resolves (name only) rather than 404ing: "hasn't filled out
  // a profile" isn't the same as "doesn't exist."
  async getPublic(
    targetUserId: string,
    isPrivileged: boolean,
    requesterIsAdmin = false,
  ): Promise<PublicProfile> {
    const [u] = await this.db
      .select({ name: user.name, isAdmin: user.isAdmin, canOrganizeEvents: user.canOrganizeEvents })
      .from(user)
      .where(eq(user.id, targetUserId));
    if (!u) {
      throw new NotFoundException();
    }
    // Only attached for an admin requester, letting an admin see/grant
    // organizer access from a user's profile page without a separate
    // admin panel existing anywhere.
    const adminFields = requesterIsAdmin
      ? { isAdmin: u.isAdmin ?? false, canOrganizeEvents: u.canOrganizeEvents ?? false }
      : {};

    const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, targetUserId));
    if (!row) {
      return { userId: targetUserId, name: u.name, ...adminFields };
    }
    if (isPrivileged) {
      const { userId: _userId, ...rest } = row;
      return { userId: targetUserId, name: u.name, ...rest, ...adminFields };
    }

    const visible = new Set(row.visibleFields);
    const result: PublicProfile = { userId: targetUserId, name: u.name, ...adminFields };
    if (visible.has("bio")) {
      result.bio = row.bio;
    }
    if (visible.has("workplace")) {
      result.workplace = row.workplace;
    }
    if (visible.has("skills")) {
      result.skills = row.skills;
    }
    if (visible.has("githubUrl")) {
      result.githubUrl = row.githubUrl;
    }
    if (visible.has("linkedinUrl")) {
      result.linkedinUrl = row.linkedinUrl;
    }
    if (visible.has("websiteUrl")) {
      result.websiteUrl = row.websiteUrl;
    }
    return result;
  }

  // Admin-only (enforced in the controller): grants or revokes the
  // site-wide "may create/organize events" capability on a non-admin user.
  async setOrganizerStatus(
    targetUserId: string,
    canOrganizeEvents: boolean,
    actorUserId: string,
  ): Promise<void> {
    const [target] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, targetUserId));
    if (!target) {
      throw new NotFoundException();
    }
    await this.db.update(user).set({ canOrganizeEvents }).where(eq(user.id, targetUserId));

    // FR-ABUSE-05 "role change": no eventId, this is a site-wide
    // capability, not a per-event role, so it lands in AuditService's
    // GLOBAL partition. Distinct action name from event_role.* since it
    // isn't a per-event role at all.
    await this.audit.log({
      actorUserId,
      action: AUDIT_ACTION.USER_ORGANIZER_STATUS_CHANGED,
      resourceType: "user",
      resourceId: targetUserId,
      metadata: { canOrganizeEvents },
    });
  }
}
