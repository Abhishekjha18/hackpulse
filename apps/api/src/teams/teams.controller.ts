import {
  CreateTeamInput,
  type CurrentUser as CurrentUserType,
  EVENT_ROLE,
  JoinTeamInput,
} from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { TeamsService } from "./teams.service";

@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post("events/:eventId/teams")
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateTeamInput)) body: CreateTeamInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.teams.create(eventId, body, user);
  }

  @Get("events/:eventId/teams")
  @Roles(EVENT_ROLE.ORGANIZER)
  listForEvent(@Param("eventId") eventId: string) {
    return this.teams.listForEvent(eventId);
  }

  @Get("teams/:teamId")
  findOne(@Param("teamId") teamId: string, @CurrentUser() user: CurrentUserType | null) {
    return this.teams.findOne(teamId, user);
  }

  @Get("events/:eventId/teams/mine")
  findMine(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    return this.teams.findMine(eventId, user.id);
  }

  @Get("users/me/teams")
  findAllMine(@CurrentUser() user: CurrentUserType) {
    return this.teams.findAllMine(user.id);
  }

  @Post("teams/join")
  join(
    @Body(new ZodValidationPipe(JoinTeamInput)) body: JoinTeamInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.teams.join(body.inviteCode, user);
  }

  @Post("teams/:teamId/invite/regenerate")
  regenerateInvite(@Param("teamId") teamId: string, @CurrentUser() user: CurrentUserType) {
    return this.teams.regenerateInvite(teamId, user);
  }

  @Delete("teams/:teamId/members/:userId")
  removeMember(
    @Param("teamId") teamId: string,
    @Param("userId") userId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.teams.removeMember(teamId, userId, user);
  }
}
