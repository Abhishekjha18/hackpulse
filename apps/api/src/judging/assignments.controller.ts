import {
  CreateAssignmentsInput,
  type CurrentUser as CurrentUserType,
  EVENT_ROLE,
} from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AssignmentsService } from "./assignments.service";

@Controller("events/:eventId/judging")
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post("assignments")
  @Roles(EVENT_ROLE.ORGANIZER)
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateAssignmentsInput)) body: CreateAssignmentsInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.assignments.create(eventId, body, user.id);
  }

  @Get("queue")
  @Roles(EVENT_ROLE.JUDGE)
  queue(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    return this.assignments.getQueue(eventId, user.id);
  }

  @Get("progress")
  @Roles(EVENT_ROLE.ORGANIZER)
  progress(@Param("eventId") eventId: string) {
    return this.assignments.getProgress(eventId);
  }
}
