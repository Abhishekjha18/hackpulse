import { z } from "zod";

export const WebhookEventType = z.enum([
  "submission.received",
  "judging.completed",
  "results.published",
  "certificate.issued",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const RegisterWebhookInput = z.object({
  targetUrl: z.string().url(),
  subscribedEvents: z.array(WebhookEventType).min(1),
});
export type RegisterWebhookInput = z.infer<typeof RegisterWebhookInput>;
