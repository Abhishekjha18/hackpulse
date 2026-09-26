import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations run as the schema-owning role, not the restricted runtime role
// (see drizzle/0001_restrict_audit_log_grants.sql / ADR-009).
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set — see .env.example");
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
