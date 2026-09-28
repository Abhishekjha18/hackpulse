import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { EventRoleInvitesModule } from "../common/event-roles/event-role-invites.module";
import { JudgeTrackScopeModule } from "../common/judge-track-scope.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { AssignmentsController } from "./assignments.controller";
import { AssignmentsService } from "./assignments.service";
import { AssignmentOwnershipGuard } from "./guards/assignment-ownership.guard";
import { TrackScopeGuard } from "./guards/track-scope.guard";
import { JudgesController } from "./judges.controller";
import { JudgesService } from "./judges.service";
import { NormalizationService } from "./normalization.service";
import { PairwiseController } from "./pairwise/pairwise.controller";
import { PairwiseService } from "./pairwise/pairwise.service";
import { ResultsController } from "./results.controller";
import { RubricsController } from "./rubrics.controller";
import { RubricsService } from "./rubrics.service";
import { ScoringController } from "./scoring.controller";
import { ScoringService } from "./scoring.service";

@Module({
  imports: [WebhooksModule, EventRoleInvitesModule, AuditModule, JudgeTrackScopeModule],
  controllers: [
    JudgesController,
    RubricsController,
    AssignmentsController,
    ScoringController,
    ResultsController,
    PairwiseController,
  ],
  providers: [
    JudgesService,
    RubricsService,
    AssignmentsService,
    ScoringService,
    NormalizationService,
    AssignmentOwnershipGuard,
    TrackScopeGuard,
    PairwiseService,
  ],
  exports: [NormalizationService, PairwiseService],
})
export class JudgingModule {}
