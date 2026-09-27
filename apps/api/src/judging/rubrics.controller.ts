import { CreateRubricInput } from "@hackpulse/shared";
import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";

import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { RubricsService } from "./rubrics.service";

@Controller("events/:eventId/judging/rubrics")
export class RubricsController {
  constructor(private readonly rubrics: RubricsService) {}

  @Post()
  @Roles("organizer")
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateRubricInput)) body: CreateRubricInput,
  ) {
    return this.rubrics.create(eventId, body);
  }

  @Get()
  @Roles("organizer", "judge")
  list(
    @Param("eventId") eventId: string,
    @Query("includeArchived") includeArchived: string | undefined,
  ) {
    return this.rubrics.listForEvent(eventId, includeArchived === "true");
  }

  @Get(":rubricId")
  @Roles("organizer", "judge")
  findOne(@Param("rubricId") rubricId: string) {
    return this.rubrics.findOne(rubricId);
  }

  @Delete(":rubricId")
  @Roles("organizer")
  delete(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.delete(eventId, rubricId);
  }

  @Delete(":rubricId/criteria/:criterionId")
  @Roles("organizer")
  deleteCriterion(
    @Param("eventId") eventId: string,
    @Param("rubricId") rubricId: string,
    @Param("criterionId") criterionId: string,
  ) {
    return this.rubrics.deleteCriterion(eventId, rubricId, criterionId);
  }

  @Post(":rubricId/archive")
  @Roles("organizer")
  archive(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.archive(eventId, rubricId);
  }

  @Post(":rubricId/unarchive")
  @Roles("organizer")
  unarchive(@Param("eventId") eventId: string, @Param("rubricId") rubricId: string) {
    return this.rubrics.unarchive(eventId, rubricId);
  }
}
