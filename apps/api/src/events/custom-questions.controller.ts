import { CreateCustomQuestionInput } from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CustomQuestionsService } from "./custom-questions.service";

@Controller("events/:eventId/custom-questions")
export class CustomQuestionsController {
  constructor(private readonly customQuestions: CustomQuestionsService) {}

  @Post()
  @Roles("organizer")
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateCustomQuestionInput)) body: CreateCustomQuestionInput,
  ) {
    return this.customQuestions.create(eventId, body);
  }

  @Get()
  @Public()
  list(@Param("eventId") eventId: string, @Query("trackId") trackId: string | undefined) {
    return this.customQuestions.listForEvent(eventId, trackId);
  }
}
