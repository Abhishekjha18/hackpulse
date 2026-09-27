import { type CurrentUser as CurrentUserType, SaveScoreInput } from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { AssignmentOwnershipGuard } from "./guards/assignment-ownership.guard";
import { ScoringService } from "./scoring.service";

@Controller("judging/scores/:assignmentId")
@UseGuards(AssignmentOwnershipGuard)
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Put()
  save(
    @Param("assignmentId") assignmentId: string,
    @Body(new ZodValidationPipe(SaveScoreInput)) body: SaveScoreInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.scoring.save(assignmentId, body, user);
  }

  @Post("submit")
  submit(@Param("assignmentId") assignmentId: string, @CurrentUser() user: CurrentUserType) {
    return this.scoring.submit(assignmentId, user);
  }

  @Get()
  findOne(@Param("assignmentId") assignmentId: string) {
    return this.scoring.findOne(assignmentId);
  }
}
