import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth.schema";
import { certificateTypeEnum } from "./enums";
import { events } from "./events.schema";

// FR-CERT-01
export const certificates = pgTable("certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  recipientUserId: text("recipient_user_id")
    .notNull()
    .references(() => user.id),
  type: certificateTypeEnum("type").notNull(),
  pdfObjectKey: text("pdf_object_key"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});

// FR-CERT-02: Ed25519-signed, publicly verifiable without authentication.
export const judgeParticipationRecords = pgTable("judge_participation_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  judgeUserId: text("judge_user_id")
    .notNull()
    .references(() => user.id),
  payload: jsonb("payload").notNull(),
  signature: text("signature").notNull(),
  publicKeyId: text("public_key_id").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
});
