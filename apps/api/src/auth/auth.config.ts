import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count, eq, like, not, or } from "drizzle-orm";

import { db } from "../db/client";
import { user as userTable } from "../db/schema";

// The two email domains load-fixtures.ts's own accounts always use
// (dogfood-*@hackpulse.local for its four dedicated checker accounts,
// *@example.org for every account derived from fixtures.json's own
// team/judge data). Excluded from the "first user" count below so that
// account never wins the admin bootstrap race just by being created
// first at boot — see the comment on databaseHooks for why that race
// exists at all.
const isFixtureAccountEmail = or(
  like(userTable.email, "%@hackpulse.local"),
  like(userTable.email, "%@example.org"),
)!;

// ADR-005: Better Auth, self-hosted against our own Postgres instance via the
// Drizzle adapter, no auth-as-a-service, no data leaving the container.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  basePath: "/api/v1/auth",
  // Both origins are trusted because the browser's page origin is `web`,
  // but requests are proxied server-to-server through it to this API
  // (ADR-002), and Better Auth checks Origin regardless of which service
  // physically receives the request.
  trustedOrigins: [
    process.env.WEB_ORIGIN ?? "http://localhost:3000",
    process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  ],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  session: {
    // FR-AUTH-03: idle session expiry
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the expiry once per day of activity
  },
  user: {
    additionalFields: {
      isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      canOrganizeEvents: { type: "boolean", required: false, defaultValue: false, input: false },
      locale: { type: "string", required: false, defaultValue: "en" },
      timezone: { type: "string", required: false, defaultValue: "UTC" },
    },
  },
  // On a fresh instance nobody can create an event (EventsService.create
  // requires isAdmin or canOrganizeEvents) or grant anyone else that
  // capability (only an existing admin can call
  // PATCH /users/:userId/organizer-status) — there's no pre-seeded demo
  // account to fall back on. Standard "first account is the instance
  // admin" bootstrap instead: after any user is created, if it's the
  // first *human* account (excluding load-fixtures.ts's own accounts —
  // see isFixtureAccountEmail above), promote it. Every account after the
  // first registers as a plain participant, same as today. Best-effort,
  // not hardened against two people registering in the same instant on a
  // literally brand-new instance — an acceptable gap for a self-hosted,
  // single-operator deployment, not a multi-tenant service.
  databaseHooks: {
    user: {
      create: {
        after: async (newUser) => {
          // A fixture-loader account itself: never eligible, regardless
          // of creation order.
          if (/@(hackpulse\.local|example\.org)$/.test(newUser.email)) {
            return;
          }
          const [{ value: total }] = await db
            .select({ value: count() })
            .from(userTable)
            .where(not(isFixtureAccountEmail));
          if (total === 1) {
            await db
              .update(userTable)
              .set({ isAdmin: true, canOrganizeEvents: true })
              .where(eq(userTable.id, newUser.id));
          }
        },
      },
    },
  },
  advanced: {
    // Sessions are opaque, httpOnly, sameSite cookies (FR-AUTH-02), never
    // readable by client-side JS.
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "hackpulse",
  },
  rateLimit: {
    // FR-AUTH-05. Better Auth hardcodes a 3-req/10s "special rule" for
    // /sign-in* and /sign-up* that overrides the top-level window/max for
    // those two routes (found by reading its rate-limiter source, not
    // assumed), too strict for a registration rush from one venue's shared
    // IP. `customRules` is the only way to override it per path.
    window: 60,
    max: 20,
    customRules: {
      // Generous: a shared-IP signup rush is expected here, and isn't
      // itself the Sybil attack (THREAT-MODEL.md §1); that needs the
      // accounts to actually vote or judge, which stays rate-limited below.
      "/sign-up/email": { window: 60, max: 30 },
      // Meaningfully strict, the real credential-stuffing surface
      // FR-AUTH-05 targets, but not the stock 3-per-10s that punishes a
      // mistyped password.
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
});
