import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { WebhookProcessor } from "./webhook.processor";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";

@Module({
  imports: [BullModule.registerQueue({ name: "webhooks" })],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
