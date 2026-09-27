import { Module } from "@nestjs/common";

import { EventRoleInvitesModule } from "../common/event-roles/event-role-invites.module";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [EventRoleInvitesModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
