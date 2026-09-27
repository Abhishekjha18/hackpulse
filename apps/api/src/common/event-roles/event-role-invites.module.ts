import { Module } from "@nestjs/common";

import { AuditModule } from "../../audit/audit.module";
import { JudgeTrackScopeModule } from "../judge-track-scope.module";
import { EventRoleInvitesService } from "./event-role-invites.service";

// Shared between JudgingModule (JudgesService delegates here) and
// EventsModule (OrganizersController uses it directly), rather than
// duplicating the invite/accept/decline state machine in each domain.
@Module({
  imports: [AuditModule, JudgeTrackScopeModule],
  providers: [EventRoleInvitesService],
  exports: [EventRoleInvitesService],
})
export class EventRoleInvitesModule {}
