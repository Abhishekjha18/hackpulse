import { Controller, Get, Param, Query } from "@nestjs/common";

import { Roles } from "../common/decorators/roles.decorator";
import { NormalizationService } from "./normalization.service";
import { RubricsService } from "./rubrics.service";

// Every route below takes rubricId from the query string, so @Roles alone
// (which only checks the :eventId in the URL) is not enough: the rubric is
// re-resolved under that event first, or an organizer of event B could read
// event A's embargoed rankings and judge names by swapping in A's rubricId.
@Controller("events/:eventId/judging/results")
export class ResultsController {
  constructor(
    private readonly normalization: NormalizationService,
    private readonly rubrics: RubricsService,
  ) {}

  @Get()
  @Roles("organizer")
  async results(@Param("eventId") eventId: string, @Query("rubricId") rubricId: string) {
    await this.rubrics.findOne(eventId, rubricId);
    return this.normalization.getResults(rubricId);
  }

  @Get("normalization-proof")
  @Roles("organizer")
  async normalizationProof(@Param("eventId") eventId: string, @Query("rubricId") rubricId: string) {
    await this.rubrics.findOne(eventId, rubricId);
    return this.normalization.getNormalizationProof(rubricId);
  }

  // FR-NORM-04
  @Get("outlier-judges")
  @Roles("organizer")
  async outlierJudges(@Param("eventId") eventId: string, @Query("rubricId") rubricId: string) {
    await this.rubrics.findOne(eventId, rubricId);
    return this.normalization.getOutlierJudges(rubricId);
  }
}
