import { Module } from "@nestjs/common";

import { JudgeTrackScopeService } from "./judge-track-scope.service";

// Shared between JudgingModule (AssignmentsService, PairwiseService) and
// EventRoleInvitesModule (invite acceptance grants track scopes): one
// provider, imported by both, instead of duplicating the judge_track_scopes
// join in each domain.
@Module({
  providers: [JudgeTrackScopeService],
  exports: [JudgeTrackScopeService],
})
export class JudgeTrackScopeModule {}
