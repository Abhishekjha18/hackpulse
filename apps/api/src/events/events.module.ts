import { Module } from "@nestjs/common";

import { EventRoleInvitesModule } from "../common/event-roles/event-role-invites.module";
import { CustomQuestionsController } from "./custom-questions.controller";
import { CustomQuestionsService } from "./custom-questions.service";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { PrizesController } from "./prizes.controller";
import { PrizesService } from "./prizes.service";

@Module({
  imports: [EventRoleInvitesModule],
  controllers: [EventsController, CustomQuestionsController, PrizesController],
  providers: [EventsService, CustomQuestionsService, PrizesService],
})
export class EventsModule {}
