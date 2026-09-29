import {
  type CurrentUser as CurrentUserType,
  EVENT_ROLE,
  InviteCoOrganizerInput,
} from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { EventRoleInvitesService } from "../common/event-roles/event-role-invites.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";

// Empty @Controller() + full literal path per method, same pattern as
// JudgesController/TeamsController. Co-organizer invites reuse
// EventRoleInvitesService (role="organizer" fixed) rather than
// reimplementing the pending/accept/decline state machine judge invites
// already have.
@Controller()
export class OrganizersController {
  constructor(private readonly invites: EventRoleInvitesService) {}

  @Post("events/:eventId/organizers")
  @Roles(EVENT_ROLE.ORGANIZER)
  invite(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(InviteCoOrganizerInput)) body: InviteCoOrganizerInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.invites.invite(eventId, user.id, "organizer", body.email, []);
  }

  @Get("events/:eventId/organizers")
  @Roles(EVENT_ROLE.ORGANIZER)
  list(@Param("eventId") eventId: string) {
    return this.invites.listForEvent(eventId, "organizer");
  }

  // Not @Roles()-guarded, same reasoning as judge-invite accept/decline:
  // the invitee isn't an organizer on this event yet, so there's no event
  // role to check against. EventRoleInvitesService verifies the caller is
  // actually who the invite was addressed to.
  @Post("events/:eventId/organizer-invites/:inviteId/accept")
  accept(
    @Param("eventId") eventId: string,
    @Param("inviteId") inviteId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.invites.accept(eventId, inviteId, user.id);
  }

  @Post("events/:eventId/organizer-invites/:inviteId/decline")
  decline(
    @Param("eventId") eventId: string,
    @Param("inviteId") inviteId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.invites.decline(eventId, inviteId, user.id);
  }

  // Not event-scoped (no :eventId in the path): the current user's own
  // pending invites across every event, both judge and co-organizer,
  // tagged by role. What the notifications bell polls. Lives here rather
  // than JudgesController since it's no longer judge-specific.
  @Get("users/me/event-invites")
  myInvites(@CurrentUser() user: CurrentUserType) {
    return this.invites.myPending(user.id);
  }
}
