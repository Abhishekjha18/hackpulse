import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// FR-CERT-02: one Ed25519 keypair per instance, generated on first use
// and persisted here so it survives restarts. Private key material never
// leaves the api/worker containers; only publicKeyId is ever referenced
// externally (in a judge_participation_records row).
export const signingKeys = pgTable("signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicKeyId: text("public_key_id").notNull().unique(),
  publicKeyDer: text("public_key_der").notNull(), // base64 SPKI
  privateKeyDer: text("private_key_der").notNull(), // base64 PKCS8
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
