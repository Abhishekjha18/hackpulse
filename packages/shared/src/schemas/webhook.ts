import { z } from "zod";

import { WEBHOOK_EVENT } from "../constants";
export const WebhookEventType = z.enum([
  WEBHOOK_EVENT.SUBMISSION_RECEIVED,
  WEBHOOK_EVENT.JUDGING_COMPLETED,
  WEBHOOK_EVENT.RESULTS_PUBLISHED,
  WEBHOOK_EVENT.CERTIFICATE_ISSUED,
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const RegisterWebhookInput = z.object({
  targetUrl: z.string().url(),
  subscribedEvents: z.array(WebhookEventType).min(1),
});
export type RegisterWebhookInput = z.infer<typeof RegisterWebhookInput>;
