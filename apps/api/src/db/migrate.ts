import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Its own connection, not ./client's: migrations need the schema-owning
// role, not the restricted runtime role. See
// drizzle/0001_restrict_audit_log_grants.sql / ADR-009.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is not set — see .env.example");
}

async function main() {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  // eslint-disable-next-line no-console
  console.log("Migrations applied.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
