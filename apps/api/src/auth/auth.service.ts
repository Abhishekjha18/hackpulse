import type { CurrentUser } from "@hackpulse/shared";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { eventRoles } from "../db/schema";
import { DB } from "../db/tokens";

interface BetterAuthSessionUser {
  id: string;
  email: string;
  name: string;
  locale?: string | null;
  timezone?: string | null;
  isAdmin?: boolean | null;
  canOrganizeEvents?: boolean | null;
}

@Injectable()
export class AuthService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Resolves the full CurrentUser shape (shared/schemas/user.ts) from a
   * Better Auth session user by attaching this user's event-scoped roles,
   * the piece RolesGuard actually authorizes against.
   */
  async toCurrentUser(sessionUser: BetterAuthSessionUser): Promise<CurrentUser> {
    const roles = await this.db
      .select({ eventId: eventRoles.eventId, role: eventRoles.role })
      .from(eventRoles)
      .where(eq(eventRoles.userId, sessionUser.id));

    return {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      locale: sessionUser.locale ?? "en",
      timezone: sessionUser.timezone ?? "UTC",
      isAdmin: sessionUser.isAdmin ?? false,
      canOrganizeEvents: sessionUser.canOrganizeEvents ?? false,
      eventRoles: roles,
    };
  }
}
