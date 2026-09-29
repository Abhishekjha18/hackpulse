import {
  CreateSubmissionInput,
  type CurrentUser as CurrentUserType,
  EVENT_ROLE,
  SetCustomAnswersInput,
  UpdateSubmissionInput,
} from "@hackpulse/shared";
import { Body, Controller, Get, Param, Patch, Post, Put } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { SubmissionsService } from "./submissions.service";

@Controller()
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post("events/:eventId/submissions")
  create(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(CreateSubmissionInput)) body: CreateSubmissionInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.submissions.create(eventId, body, user.id);
  }

  // FR-ABUSE-02/03 — organizer-facing duplicate-content report.
  @Get("events/:eventId/submissions/duplicates")
  @Roles(EVENT_ROLE.ORGANIZER)
  duplicates(@Param("eventId") eventId: string) {
    return this.submissions.findDuplicates(eventId);
  }

  @Get("events/:eventId/submissions/mine")
  mine(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    return this.submissions.findMineForEvent(eventId, user.id);
  }

  @Get("submissions/:submissionId")
  @Public()
  findOne(
    @Param("submissionId") submissionId: string,
    @CurrentUser() user: CurrentUserType | null,
  ) {
    return this.submissions.findOne(submissionId, user);
  }

  @Patch("submissions/:submissionId")
  update(
    @Param("submissionId") submissionId: string,
    @Body(new ZodValidationPipe(UpdateSubmissionInput)) body: UpdateSubmissionInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.submissions.update(submissionId, body, user);
  }

  @Post("submissions/:submissionId/submit")
  submit(@Param("submissionId") submissionId: string, @CurrentUser() user: CurrentUserType) {
    return this.submissions.submit(submissionId, user);
  }

  @Get("submissions/:submissionId/revisions")
  revisions(@Param("submissionId") submissionId: string, @CurrentUser() user: CurrentUserType) {
    return this.submissions.revisions(submissionId, user);
  }

  @Put("submissions/:submissionId/custom-answers")
  setCustomAnswers(
    @Param("submissionId") submissionId: string,
    @Body(new ZodValidationPipe(SetCustomAnswersInput)) body: SetCustomAnswersInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.submissions.setCustomAnswers(submissionId, body, user);
  }

  // @Public() to match GET submissions/:submissionId's own visibility
  // rules (a public gallery visitor can view a submitted project's
  // details without an account) — getCustomAnswers() re-checks the same
  // draft/gallery-visibility gate findOne() enforces before returning
  // anything, rather than trusting the route decorator alone.
  @Get("submissions/:submissionId/custom-answers")
  @Public()
  getCustomAnswers(
    @Param("submissionId") submissionId: string,
    @CurrentUser() user: CurrentUserType | null,
  ) {
    return this.submissions.getCustomAnswers(submissionId, user);
  }
}
