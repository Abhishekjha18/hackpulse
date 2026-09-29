// Delivery attempt states for a webhook call. Keys are alphabetical.
export const WEBHOOK_DELIVERY_STATUS = {
  FAILED: "failed",
  PENDING: "pending",
  SUCCEEDED: "succeeded",
} as const;

// Event names delivered to registered webhooks (WebhooksService.trigger).
// Keys are alphabetical.
export const WEBHOOK_EVENT = {
  CERTIFICATE_ISSUED: "certificate.issued",
  JUDGING_COMPLETED: "judging.completed",
  RESULTS_PUBLISHED: "results.published",
  SUBMISSION_RECEIVED: "submission.received",
} as const;
