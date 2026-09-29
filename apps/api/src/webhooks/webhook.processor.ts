import { createHmac } from "node:crypto";

import { WEBHOOK_DELIVERY_STATUS } from "@hackpulse/shared";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import type { Job } from "bullmq";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { webhookDeliveries, webhooks } from "../db/schema";
import { DB } from "../db/tokens";
interface DeliverJobData {
  deliveryId: string;
}

/**
 * FR-API-03 — signs each payload with the webhook's own secret
 * (X-HackPulse-Signature: HMAC-SHA256 of the raw body). Throwing on
 * failure is what tells BullMQ to reschedule via its configured
 * attempts/backoff (webhooks.service.ts).
 */
@Processor("webhooks")
export class WebhookProcessor extends WorkerHost {
  constructor(@Inject(DB) private readonly db: Database) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    const [delivery] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, job.data.deliveryId));
    if (!delivery) {
      return;
    }

    const [webhook] = await this.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, delivery.webhookId));
    if (!webhook || !webhook.isActive) {
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");

    let responseCode: number | null = null;
    let ok = false;
    try {
      const res = await fetch(webhook.targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-HackPulse-Signature": signature,
          "X-HackPulse-Event": delivery.eventType,
        },
        body,
      });
      responseCode = res.status;
      ok = res.ok;
    } finally {
      await this.db
        .update(webhookDeliveries)
        .set({
          status: ok ? WEBHOOK_DELIVERY_STATUS.SUCCEEDED : WEBHOOK_DELIVERY_STATUS.FAILED,
          attemptCount: sql`${webhookDeliveries.attemptCount} + 1`,
          lastAttemptAt: new Date(),
          responseCode,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
    }

    if (!ok) {
      throw new Error(`Webhook target responded ${responseCode ?? "with a network error"}`);
    }
  }
}
