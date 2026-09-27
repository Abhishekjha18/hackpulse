import type { CurrentUser, EventRole } from "@hackpulse/shared";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ROLES_KEY } from "../decorators/roles.decorator";

interface AuthenticatedRequest {
  user: CurrentUser | null;
  params: Record<string, string>;
}

/**
 * Enforces FR-ROLE-01/04/05: a route decorated with @Roles(...) may only be
 * called by a user holding one of those roles *for the event referenced by
 * the route's :eventId param*. Absence of a scope row is a deny, never an
 * implicit allow.
 *
 * Found live: this used to let any user.isAdmin through unconditionally,
 * giving admins organizer-level access to every event on the instance, not
 * just ones they actually organize. Removed — admins still create their own
 * events and grant other users canOrganizeEvents, they just no longer get
 * organizer access to events they don't hold a role on.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<EventRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator means the route is intentionally open (still
    // behind whatever AuthGuard requires), not a bypass of this guard.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException();
    }

    const eventId = request.params.eventId;
    const hasRole = user.eventRoles.some((r) => r.eventId === eventId && required.includes(r.role));

    if (!hasRole) {
      throw new ForbiddenException();
    }

    return true;
  }
}
