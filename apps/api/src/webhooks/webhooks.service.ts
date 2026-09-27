import { randomBytes } from "node:crypto";

import type { RegisterWebhookInput, WebhookEventType } from "@hackpulse/shared";
import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { webhookDeliveries, webhooks } from "../db/schema";
import { DB } from "../db/tokens";

const DELIVERY_JOB_OPTS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 } as const,
};

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @InjectQueue("webhooks") private readonly queue: Queue,
  ) {}

  // FR-API-03 — the secret is returned once, at registration; it's not
  // re-readable afterward (the organizer must save it then, same as most
  // webhook providers).
  async register(eventId: string, input: RegisterWebhookInput) {
    const secret = randomBytes(24).toString("hex");
    const [webhook] = await this.db
      .insert(webhooks)
      .values({
        eventId,
        targetUrl: input.targetUrl,
        secret,
        subscribedEvents: input.subscribedEvents,
      })
      .returning();
    return webhook;
  }

  /** Called from other modules at the four lifecycle points named in
   * API-DESIGN.md §3 — never awaited for delivery, only for enqueueing. */
  async trigger(eventId: string, eventType: WebhookEventType, payload: Record<string, unknown>) {
    const subscribed = await this.db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.eventId, eventId), eq(webhooks.isActive, true)));

    for (const webhook of subscribed) {
      if (!webhook.subscribedEvents.includes(eventType)) {
        continue;
      }

      const [delivery] = await this.db
        .insert(webhookDeliveries)
        .values({ webhookId: webhook.id, eventType, payload, status: "pending" })
        .returning();

      await this.queue.add("deliver", { deliveryId: delivery.id }, DELIVERY_JOB_OPTS);
    }
  }

  async getDeliveries(webhookId: string) {
    return this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId));
  }

  async redeliver(webhookId: string, deliveryId: string) {
    const [delivery] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, webhookId)));
    if (!delivery) {
      throw new NotFoundException();
    }

    await this.queue.add("deliver", { deliveryId }, DELIVERY_JOB_OPTS);
    return delivery;
  }
}
