/** DI token for the Drizzle client, kept separate from `./client` (which
 * eagerly opens a real Postgres Pool on import) so anything that only needs
 * the token, like a guard under test with a fake db, doesn't transitively
 * require DATABASE_URL to be set. */
export const DB = "DB";
