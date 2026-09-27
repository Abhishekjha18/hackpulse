import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ResultsService } from "./results.service";

@Controller("events/:eventId/results")
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @Public()
  getResults(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType | null) {
    return this.results.getResults(eventId, user);
  }

  @Get("preview")
  @Roles("organizer")
  preview(@Param("eventId") eventId: string) {
    return this.results.getPreview(eventId);
  }

  // Allows the organizer dashboard to display unjudged submissions before publish.
  @Get("unjudged")
  @Roles("organizer")
  unjudged(@Param("eventId") eventId: string) {
    return this.results.findUnjudgedSubmissions(eventId);
  }

  @Post("publish")
  @Roles("organizer")
  publish(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    return this.results.publish(eventId, user);
  }
}
