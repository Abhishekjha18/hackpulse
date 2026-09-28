import { Controller, Get, Query } from "@nestjs/common";

import { Roles } from "../common/decorators/roles.decorator";
import { NormalizationService } from "./normalization.service";

@Controller("events/:eventId/judging/results")
export class ResultsController {
  constructor(private readonly normalization: NormalizationService) {}

  @Get()
  @Roles("organizer")
  results(@Query("rubricId") rubricId: string) {
    return this.normalization.getResults(rubricId);
  }

  @Get("normalization-proof")
  @Roles("organizer")
  normalizationProof(@Query("rubricId") rubricId: string) {
    return this.normalization.getNormalizationProof(rubricId);
  }

  // FR-NORM-04
  @Get("outlier-judges")
  @Roles("organizer")
  outlierJudges(@Query("rubricId") rubricId: string) {
    return this.normalization.getOutlierJudges(rubricId);
  }
}
