import { Module } from "@nestjs/common";

import { EventRoleInvitesModule } from "../common/event-roles/event-role-invites.module";
import { CustomQuestionsController } from "./custom-questions.controller";
import { CustomQuestionsService } from "./custom-questions.service";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [EventRoleInvitesModule],
  controllers: [EventsController, CustomQuestionsController],
  providers: [EventsService, CustomQuestionsService],
})
export class EventsModule {}
