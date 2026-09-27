import { RegisterWebhookInput } from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { WebhooksService } from "./webhooks.service";

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("events/:eventId/webhooks")
  @Roles("organizer")
  register(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(RegisterWebhookInput)) body: RegisterWebhookInput,
  ) {
    return this.webhooks.register(eventId, body);
  }

  // eventId stays in the path (unused in the handler body) purely so
  // RolesGuard — which resolves the caller's role from :eventId — has
  // something to check; a route with no eventId segment would silently
  // deny every organizer (RolesGuard has no event to match their role
  // against), which is a worse failure mode than an unused param.
  @Get("events/:eventId/webhooks/:webhookId/deliveries")
  @Roles("organizer")
  deliveries(@Param("webhookId") webhookId: string) {
    return this.webhooks.getDeliveries(webhookId);
  }

  @Post("events/:eventId/webhooks/:webhookId/redeliver/:deliveryId")
  @Roles("organizer")
  redeliver(@Param("webhookId") webhookId: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.redeliver(webhookId, deliveryId);
  }
}
