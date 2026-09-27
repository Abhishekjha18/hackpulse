import type { CurrentUser } from "@hackpulse/shared";

// Was independently reimplemented across several services, most with an
// isAdmin auto-bypass. That bypass is deliberately gone here: an admin
// only gets organizer access via an actual per-event "organizer" role,
// same as anyone else.
export function isEventOrganizer(user: CurrentUser | null, eventId: string): boolean {
  if (!user) {
    return false;
  }
  return user.eventRoles.some((r) => r.eventId === eventId && r.role === "organizer");
}
