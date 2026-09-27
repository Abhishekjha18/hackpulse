import type { EventRole } from "@hackpulse/shared";
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "hackpulse:roles";

/**
 * Declares the minimum event-scoped role(s) required to call a route.
 * Read by RolesGuard against the caller's `event_roles` for the event
 * resolved from the route (see ARCHITECTURE.md §6).
 */
export const Roles = (...roles: EventRole[]) => SetMetadata(ROLES_KEY, roles);
