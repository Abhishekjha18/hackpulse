import { type CurrentUser as CurrentUserType, PairwiseCompareInput } from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import { CurrentUser } from "../../auth/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { TrackScopeGuard } from "../guards/track-scope.guard";
import { PairwiseService } from "./pairwise.service";

@Controller("events/:eventId/pairwise")
export class PairwiseController {
  constructor(private readonly pairwise: PairwiseService) {}

  @Get("next")
  @Roles("judge")
  @UseGuards(TrackScopeGuard)
  next(
    @Param("eventId") eventId: string,
    @Query("trackId") trackId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.pairwise.getNextPair(eventId, trackId, user.id);
  }

  @Post("compare")
  @Roles("judge")
  @UseGuards(TrackScopeGuard)
  compare(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(PairwiseCompareInput)) body: PairwiseCompareInput,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.pairwise.compare(eventId, body, user.id);
  }

  @Get("rankings")
  @Roles("organizer")
  rankings(@Param("eventId") eventId: string, @Query("trackId") trackId: string) {
    return this.pairwise.getRankings(eventId, trackId);
  }

  // Judge-facing, self-scoped (no trackId param -- derives the caller's
  // own scoped tracks), mirroring AssignmentsController's "queue" for
  // rubric mode. Backs the notifications bell's pending-judging reminder
  // for pairwise-mode events.
  @Get("progress")
  @Roles("judge")
  progress(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    return this.pairwise.getProgressForJudge(eventId, user.id);
  }

  // Organizer-facing, every judge on every track -- mirrors
  // AssignmentsController's "progress" for rubric mode. Backs the
  // organizer dashboard's "Judging progress" section for pairwise-mode
  // events, which previously showed nothing (it only ever read the
  // rubric-mode assignment table).
  @Get("organizer-progress")
  @Roles("organizer")
  organizerProgress(@Param("eventId") eventId: string) {
    return this.pairwise.getProgressForOrganizer(eventId);
  }
}
