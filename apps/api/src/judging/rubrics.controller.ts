import { CreateRubricInput, EVENT_ROLE } from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";

import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RubricsService } from "./rubrics.service";

@Controller("events/:eventId/judging/rubrics")
export class RubricsController {
  constructor(private readonly rubrics: RubricsService) {}

  @Post()
  @Roles(EVENT_ROLE.ORGANIZER)
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateRubricInput)) body: CreateRubricInput,
  ) {
    return this.rubrics.create(eventId, body);
  }

  @Get()
  @Roles(EVENT_ROLE.ORGANIZER, EVENT_ROLE.JUDGE)
  list(
    @Param("eventId") eventId: string,
    @Query("includeArchived") includeArchived: string | undefined,
  ) {
    return this.rubrics.listForEvent(eventId, includeArchived === "true");
  }

  @Get(":rubricId")
  @Roles(EVENT_ROLE.ORGANIZER, EVENT_ROLE.JUDGE)
  findOne(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.findOne(eventId, rubricId);
  }

  @Delete(":rubricId")
  @Roles(EVENT_ROLE.ORGANIZER)
  delete(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.delete(eventId, rubricId);
  }

  @Delete(":rubricId/criteria/:criterionId")
  @Roles(EVENT_ROLE.ORGANIZER)
  deleteCriterion(
    @Param("eventId") eventId: string,
    @Param("rubricId") rubricId: string,
    @Param("criterionId") criterionId: string,
  ) {
    return this.rubrics.deleteCriterion(eventId, rubricId, criterionId);
  }

  @Post(":rubricId/archive")
  @Roles(EVENT_ROLE.ORGANIZER)
  archive(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.archive(eventId, rubricId);
  }

  @Post(":rubricId/unarchive")
  @Roles(EVENT_ROLE.ORGANIZER)
  unarchive(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.unarchive(eventId, rubricId);
  }
}
