import {
  type CurrentUser as CurrentUserType,
  InviteJudgeInput,
  SelfJudgeInput,
} from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { JudgesService } from "./judges.service";

// Empty @Controller() + full literal path per method, same pattern as
// TeamsController/OrganizersController: this module needs multiple
// event-scoped route shapes (events/:eventId/judges,
// events/:eventId/judge-invites/:inviteId/...), which a single
// @Controller(prefix) can't express. The current user's own pending
// invites live on OrganizersController (users/me/event-invites) since
// that list spans both judge and co-organizer invites.
@Controller()
export class JudgesController {
  constructor(private readonly judges: JudgesService) {}

  @Post("events/:eventId/judges")
  @Roles("organizer")
  invite(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(InviteJudgeInput)) body: InviteJudgeInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.judges.invite(eventId, user.id, body);
  }

  @Get("events/:eventId/judges")
  @Roles("organizer")
  list(@Param("eventId") eventId: string) {
    return this.judges.listForEvent(eventId);
  }

  @Post("events/:eventId/judges/self")
  @Roles("organizer")
  selfJudge(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(SelfJudgeInput)) body: SelfJudgeInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.judges.selfJudge(eventId, user.id, body);
  }

  @Delete("events/:eventId/judges/:eventRoleId")
  @Roles("organizer")
  remove(
    @Param("eventId") eventId: string,
    @Param("eventRoleId") eventRoleId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.judges.remove(eventId, eventRoleId, user.id);
  }

  // Not @Roles()-guarded — the invitee isn't a judge on this event yet
  // (that's the entire point of "pending"), so there's no event role to
  // check against. JudgesService verifies the caller is actually who the
  // invite was addressed to.
  @Post("events/:eventId/judge-invites/:inviteId/accept")
  accept(
    @Param("eventId") eventId: string,
    @Param("inviteId") inviteId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.judges.acceptInvite(eventId, inviteId, user.id);
  }

  @Post("events/:eventId/judge-invites/:inviteId/decline")
  decline(
    @Param("eventId") eventId: string,
    @Param("inviteId") inviteId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.judges.declineInvite(eventId, inviteId, user.id);
  }
}
