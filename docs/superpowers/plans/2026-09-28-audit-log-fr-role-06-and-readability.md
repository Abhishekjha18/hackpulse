# Audit Log: FR-ROLE-06 Enforcement, Readability, Admin View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the confirmed FR-ROLE-06 gap (denied authorization attempts on scores/audit-log are never logged), make every audit log entry human-readable (real names and plain-English actions instead of raw IDs and dot-separated codes), and give admins the "full audit access" REQUIREMENTS.md's Admin role definition promises but the UI currently blocks.

**Architecture:** Three independent layers, built bottom-up. (1) A new pure formatter module (`audit-format.ts`) maps a raw audit row + batch-resolved name lookups to human `actorName`/`actionLabel`/`resourceLabel` strings — fully unit-testable with no DB. (2) Three guards/controllers that currently `throw ForbiddenException()` with no trace gain an `audit.log(...)` call on the deny path, using three new action strings the formatter already knows about. (3) `AuditService.list()` is wired to batch-resolve names and run every row through the formatter before returning, so both existing consumers (the organizer dashboard) and a new one (the admin audit view) get readable data for free. The admin view itself is a new frontend page reachable two ways: a global nav link (instance-wide partition) and a link on any event's page for an admin who isn't that event's organizer (that event's own partition, via the existing `isEventOrganizer || isAdmin` backend bypass that today has no UI path to it).

**Tech Stack:** NestJS (Fastify), Drizzle ORM, Postgres, Jest, Next.js (App Router), TypeScript, Zod.

**Spec:** `REQUIREMENTS.md` — FR-ROLE-06 (§3.2, line 43), FR-ABUSE-05 (§3.16, line 151), the Admin role definition ("full audit access", §1, line 21).

## Global Constraints

- Every new/changed backend file follows this repo's existing comment convention: a short comment tying non-obvious logic back to its FR/NFR code, not restating what the code does.
- No new DB migration: `audit_log_entries.action` and `.resource_type` are free-text (`text`, not a Postgres enum), so new action/resource-type string literals need no schema change.
- `AuditService.log()`'s existing hash-chain behavior (canonical stringify, prevHash, entryHash) is untouched — every task only adds new call sites or enriches read-side output, never changes what gets hashed or how.
- Jest is this repo's test runner (`apps/api/package.json`'s `test` script; see `apps/api/jest.config.js`). Run scoped tests with `pnpm --filter @hackpulse/api exec jest <path>`.
- Frontend files are Next.js App Router client components (`"use client"`), consistent with every existing file under `apps/web/app`.

## Review Focus

- **Anonymous actor**: `voting.service.ts`'s `vote.cast` can log with `actorUserId: null` (anonymous voting). The formatter must render this as "Anonymous", never crash on a null actor or print `"null"`/`"undefined"`.
- **Actor/target user no longer resolvable**: a lookup map miss (e.g., a metadata-referenced `targetUserId` whose row can't be found for any reason) must fall back to a plain "Unknown user" string, never throw or render `undefined`.
- **A non-admin hitting the new admin page directly by URL**: `/admin/audit-log` must show a clear "not authorized" message, matching the organizer dashboard's existing pattern, not a blank page or an unhandled fetch rejection.
- **`?eventId=` for an event the admin doesn't organize, or that doesn't exist**: the admin page must handle both the intended case (backend's `isEventOrganizer || isAdmin` bypass returns data) and a 404 for a bad id (surfaced as a readable error, not a crash).
- **Metadata shape drift**: `metadata` is untyped `jsonb`; the formatter reads fields like `m.role`, `m.targetUserId`, `m.submissionId` defensively (`typeof` guards) so a missing or wrong-shaped field degrades to a fallback string instead of throwing.

---

## Task 1: Pure audit-entry formatter

**Files:**

- Create: `apps/api/src/audit/audit-format.ts`
- Test: `apps/api/src/audit/audit-format.spec.ts`

**Interfaces:**

- Produces: `AuditLogRow` (input row shape), `NameLookups` (`{ userNames: Map<string,string>; submissionNames: Map<string,string>; trackNames: Map<string,string> }`), `DescribedAuditEntry` (`AuditLogRow & { actorName: string; actionLabel: string; resourceLabel: string }`), `ACTION_LABELS: Record<string, string>`, `describeAuditEntry(row: AuditLogRow, lookups: NameLookups): DescribedAuditEntry`. Task 2 consumes all of these.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/audit/audit-format.spec.ts
import {
  ACTION_LABELS,
  type AuditLogRow,
  describeAuditEntry,
  type NameLookups,
} from "./audit-format";

function row(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: "row-1",
    eventId: "event-1",
    actorUserId: "actor-1",
    action: "vote.cast",
    resourceType: "submission",
    resourceId: "sub-1",
    metadata: {},
    createdAt: new Date("2026-09-28T13:45:00Z"),
    ...overrides,
  };
}

function emptyLookups(): NameLookups {
  return { userNames: new Map(), submissionNames: new Map(), trackNames: new Map() };
}

describe("describeAuditEntry", () => {
  it("resolves the actor's name from the lookup map", () => {
    const lookups = emptyLookups();
    lookups.userNames.set("actor-1", "Priya Sharma");
    const described = describeAuditEntry(row({}), lookups);
    expect(described.actorName).toBe("Priya Sharma");
  });

  it("labels a null actor as Anonymous, never crashing", () => {
    const described = describeAuditEntry(row({ actorUserId: null }), emptyLookups());
    expect(described.actorName).toBe("Anonymous");
  });

  it("falls back to Unknown user when the actor id isn't in the lookup map", () => {
    const described = describeAuditEntry(row({ actorUserId: "ghost" }), emptyLookups());
    expect(described.actorName).toBe("Unknown user");
  });

  it("gives every action string in ACTION_LABELS a non-empty human label", () => {
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(action);
    }
  });

  it("falls back to the raw action string for an unmapped action", () => {
    const described = describeAuditEntry(row({ action: "something.new" }), emptyLookups());
    expect(described.actionLabel).toBe("something.new");
  });

  it("resolves a score action's resource label via metadata.submissionId", () => {
    const lookups = emptyLookups();
    lookups.submissionNames.set("sub-1", "Glass Signal");
    const described = describeAuditEntry(
      row({
        action: "score.submit",
        resourceType: "score",
        resourceId: "score-1",
        metadata: { submissionId: "sub-1" },
      }),
      lookups,
    );
    expect(described.resourceLabel).toBe('"Glass Signal"');
  });

  it("falls back to a generic label when a score's submission can't be resolved", () => {
    const described = describeAuditEntry(
      row({ action: "score.submit", resourceType: "score", resourceId: "score-1", metadata: {} }),
      emptyLookups(),
    );
    expect(described.resourceLabel).toBe("a submission");
  });

  it("resolves event_role.revoked's target from metadata.targetUserId, not the actor", () => {
    const lookups = emptyLookups();
    lookups.userNames.set("actor-1", "Organizer Name");
    lookups.userNames.set("target-1", "Judge Name");
    const described = describeAuditEntry(
      row({
        action: "event_role.revoked",
        resourceType: "event_role",
        resourceId: "role-1",
        metadata: { role: "judge", targetUserId: "target-1" },
      }),
      lookups,
    );
    expect(described.resourceLabel).toBe("Judge Name — judge");
  });

  it("labels an audit_log.access_denied entry by whether it has an eventId", () => {
    const perEvent = describeAuditEntry(
      row({
        action: "audit_log.access_denied",
        resourceType: "event",
        resourceId: "event-1",
        eventId: "event-1",
      }),
      emptyLookups(),
    );
    expect(perEvent.resourceLabel).toBe("this event's audit log");

    const global = describeAuditEntry(
      row({
        action: "audit_log.access_denied",
        resourceType: "instance",
        resourceId: "GLOBAL",
        eventId: null,
      }),
      emptyLookups(),
    );
    expect(global.resourceLabel).toBe("the instance-wide audit log");
  });

  it("resolves track_scope.access_denied's resource label from the track lookup", () => {
    const lookups = emptyLookups();
    lookups.trackNames.set("track-1", "Security");
    const described = describeAuditEntry(
      row({ action: "track_scope.access_denied", resourceType: "track", resourceId: "track-1" }),
      lookups,
    );
    expect(described.resourceLabel).toBe("Security");
  });

  it("never throws on a metadata field of the wrong type", () => {
    expect(() =>
      describeAuditEntry(
        row({ action: "event_role.granted", metadata: { role: 42, self: "yes" } }),
        emptyLookups(),
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @hackpulse/api exec jest audit-format -- --no-coverage`
Expected: FAIL — `Cannot find module './audit-format'`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/api/src/audit/audit-format.ts

// FR-ABUSE-05's log stores machine-shaped rows (dot-separated action codes,
// bare actor/resource ids) by design — that's what the hash chain covers.
// Turning that into something a human can actually read without cross-
// referencing ids by hand is a read-side concern, kept here as pure
// functions so it's testable without a database.
export interface AuditLogRow {
  id: string;
  eventId: string | null;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: unknown;
  createdAt: Date;
}

export interface DescribedAuditEntry extends AuditLogRow {
  actorName: string;
  actionLabel: string;
  resourceLabel: string;
}

export interface NameLookups {
  userNames: Map<string, string>;
  submissionNames: Map<string, string>;
  trackNames: Map<string, string>;
}

// One label per action string that AuditService.log() is ever called with —
// see the grep-verified inventory in this plan's design notes. An action
// missing here still renders (describeAuditEntry falls back to the raw
// string), so a new call site never breaks the UI, it just reads as raw
// until a label is added here.
export const ACTION_LABELS: Record<string, string> = {
  "auth.sign_in": "Signed in",
  "auth.sign_up": "Signed up",
  "auth.sign_out": "Signed out",
  "event_role.granted": "Joined a role",
  "event_role.revoked": "Removed from a role",
  "user.organizer_status_changed": "Changed organizer access",
  "score.window_rejected": "Blocked — judging window closed",
  "score.edit": "Edited a submitted score",
  "score.submit": "Submitted a score",
  "score.access_denied": "Blocked — tried to view another judge's score",
  "results.publish": "Published results",
  "export.archive": "Exported the full event archive",
  "export.csv": "Exported data",
  "import.csv": "Imported data",
  "submission.deadline_rejected": "Blocked — submission deadline",
  "track_scope.access_denied": "Blocked — tried to judge outside assigned track",
  "audit_log.access_denied": "Blocked — tried to view the audit log",
  "vote.cast": "Cast a vote",
};

function meta(row: AuditLogRow): Record<string, unknown> {
  return row.metadata !== null && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nameOrFallback(
  id: string | undefined,
  names: Map<string, string>,
  fallback: string,
): string {
  if (!id) {
    return fallback;
  }
  return names.get(id) ?? "Unknown user";
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export function resourceLabelFor(row: AuditLogRow, lookups: NameLookups): string {
  const m = meta(row);
  switch (row.action) {
    case "event_role.granted": {
      const role = str(m.role) ?? "role";
      return m.self === true ? `${capitalize(role)} (self-judged)` : capitalize(role);
    }
    case "event_role.revoked": {
      const role = str(m.role) ?? "role";
      const targetName = nameOrFallback(str(m.targetUserId), lookups.userNames, "Unknown user");
      return `${targetName} — ${role}`;
    }
    case "user.organizer_status_changed":
      return nameOrFallback(row.resourceId, lookups.userNames, "Unknown user");
    case "score.edit":
    case "score.submit":
    case "score.access_denied": {
      const submissionId = str(m.submissionId);
      const name = submissionId ? lookups.submissionNames.get(submissionId) : undefined;
      return name ? `"${name}"` : "a submission";
    }
    case "score.window_rejected": {
      const attempted = str(m.attemptedAction) ?? "act";
      return `attempted to ${attempted}`;
    }
    case "export.csv":
    case "import.csv": {
      const resource = str(m.resource) ?? "event data";
      const format = str(m.format) ?? "csv";
      return `${resource} (${format})`;
    }
    case "export.archive":
      return "full event archive";
    case "results.publish":
      return "results";
    case "submission.deadline_rejected": {
      if (row.resourceType === "submission") {
        return nameOrFallback(row.resourceId, lookups.submissionNames, "a submission");
      }
      const attempted = str(m.attemptedAction) ?? "submit";
      return `attempted to ${attempted} a new submission`;
    }
    case "track_scope.access_denied":
      return nameOrFallback(row.resourceId, lookups.trackNames, "a track");
    case "audit_log.access_denied":
      return row.eventId ? "this event's audit log" : "the instance-wide audit log";
    case "auth.sign_in":
    case "auth.sign_up":
    case "auth.sign_out":
      return nameOrFallback(row.resourceId, lookups.userNames, "an account");
    case "vote.cast":
      return "a vote";
    default:
      return `${row.resourceType} ${row.resourceId.slice(0, 8)}`;
  }
}

export function describeAuditEntry(row: AuditLogRow, lookups: NameLookups): DescribedAuditEntry {
  const actorName = row.actorUserId
    ? (lookups.userNames.get(row.actorUserId) ?? "Unknown user")
    : "Anonymous";
  return {
    ...row,
    actorName,
    actionLabel: ACTION_LABELS[row.action] ?? row.action,
    resourceLabel: resourceLabelFor(row, lookups),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hackpulse/api exec jest audit-format -- --no-coverage`
Expected: PASS, all 11 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit/audit-format.ts apps/api/src/audit/audit-format.spec.ts
git commit -m "feat(audit): add pure formatter for human-readable audit entries"
```

---

## Task 2: Wire the formatter into AuditService.list()

**Files:**

- Modify: `apps/api/src/audit/audit.service.ts:1-9` (imports), `:118-149` (`list()`)
- Test: `apps/api/src/audit/audit.service.spec.ts`

**Interfaces:**

- Consumes: `describeAuditEntry`, `NameLookups`, `DescribedAuditEntry` from Task 1's `./audit-format`.
- Produces: `AuditService.list()` now returns `{ items: DescribedAuditEntry[], nextCursor: string | null }` instead of raw rows. Both `AuditController` and `AuditGlobalController` (Task 5) get this automatically since they just return `this.audit.list(...)` — no controller change needed for this task.

- [ ] **Step 1: Write the failing test**

```typescript
// Append to apps/api/src/audit/audit.service.spec.ts
import { user } from "../db/schema/auth.schema";
import { submissions } from "../db/schema/submissions.schema";
import { tracks } from "../db/schema/events.schema";
import { auditLogEntries } from "../db/schema/audit.schema";

function makeListDb(
  auditRows: Row[],
  userRows: { id: string; name: string }[],
  submissionRows: { id: string; name: string }[] = [],
  trackRows: { id: string; name: string }[] = [],
) {
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === auditLogEntries) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve(auditRows),
              }),
            }),
          };
        }
        if (table === user) {
          return { where: () => Promise.resolve(userRows) };
        }
        if (table === submissions) {
          return { where: () => Promise.resolve(submissionRows) };
        }
        if (table === tracks) {
          return { where: () => Promise.resolve(trackRows) };
        }
        throw new Error("makeListDb: unexpected table in .from()");
      },
    }),
  } as unknown as Database;
}

describe("AuditService.list", () => {
  it("resolves the actor's name and returns it alongside the raw row", async () => {
    const rows = makeChain("event-1", ["score.submit"]);
    const service = new AuditService(makeListDb(rows, [{ id: "user-1", name: "Priya Sharma" }]));
    const result = await service.list("event-1", {});
    expect(result.items[0].actorName).toBe("Priya Sharma");
    expect(result.items[0].actionLabel).toBe("Submitted a score");
    // Raw fields are still present — existing consumers reading .action etc. don't break.
    expect(result.items[0].action).toBe("score.submit");
  });

  it("resolves nothing and still returns a usable shape when no rows have an actor", async () => {
    const rows = makeChain("event-1", ["vote.cast"]).map((r) => ({ ...r, actorUserId: null }));
    const service = new AuditService(makeListDb(rows, []));
    const result = await service.list("event-1", {});
    expect(result.items[0].actorName).toBe("Anonymous");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hackpulse/api exec jest audit.service -- --no-coverage`
Expected: FAIL — `result.items[0].actorName` is `undefined`

- [ ] **Step 3: Implement `describeEntries` and wire it into `list()`**

```typescript
// apps/api/src/audit/audit.service.ts — replace the existing imports block with:
import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { auditLogEntries, submissions, tracks, user } from "../db/schema";
import { DB } from "../db/tokens";
import { type AuditLogRow, describeAuditEntry, type NameLookups } from "./audit-format";
```

```typescript
// Replace the existing `list()` method body with:
  async list(
    eventId: string | null,
    opts: { since?: Date; action?: string; cursor?: string; limit?: number },
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [
      eventId ? eq(auditLogEntries.eventId, eventId) : isNull(auditLogEntries.eventId),
    ];
    if (opts.action) {
      conditions.push(eq(auditLogEntries.action, opts.action));
    }
    if (opts.since) {
      conditions.push(sql`${auditLogEntries.createdAt} >= ${opts.since}`);
    }
    if (opts.cursor) {
      conditions.push(lt(auditLogEntries.createdAt, new Date(opts.cursor)));
    }

    const rows = await this.db
      .select()
      .from(auditLogEntries)
      .where(and(...conditions))
      .orderBy(desc(auditLogEntries.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const described = await this.describeEntries(items);
    return {
      items: described,
      nextCursor: hasMore ? items.at(-1)!.createdAt.toISOString() : null,
    };
  }

  // Read-side only: batches the id lookups every entry in a page might need
  // (actor, an event_role revoke's target, a score's submission, a denied
  // track) into three queries total, regardless of page size, then runs
  // every row through the pure formatter (audit-format.ts).
  private async describeEntries(rows: AuditLogRow[]) {
    const userIds = new Set<string>();
    const submissionIds = new Set<string>();
    const trackIds = new Set<string>();

    for (const row of rows) {
      if (row.actorUserId) {
        userIds.add(row.actorUserId);
      }
      if (row.resourceType === "user") {
        userIds.add(row.resourceId);
      }
      if (row.resourceType === "submission") {
        submissionIds.add(row.resourceId);
      }
      if (row.resourceType === "track") {
        trackIds.add(row.resourceId);
      }
      const metadata =
        row.metadata !== null && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {};
      if (typeof metadata.targetUserId === "string") {
        userIds.add(metadata.targetUserId);
      }
      if (typeof metadata.submissionId === "string") {
        submissionIds.add(metadata.submissionId);
      }
    }

    const [userRows, submissionRows, trackRows] = await Promise.all([
      userIds.size > 0
        ? this.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, [...userIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
      submissionIds.size > 0
        ? this.db
            .select({ id: submissions.id, name: submissions.name })
            .from(submissions)
            .where(inArray(submissions.id, [...submissionIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
      trackIds.size > 0
        ? this.db
            .select({ id: tracks.id, name: tracks.name })
            .from(tracks)
            .where(inArray(tracks.id, [...trackIds]))
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const lookups: NameLookups = {
      userNames: new Map(userRows.map((r) => [r.id, r.name])),
      submissionNames: new Map(submissionRows.map((r) => [r.id, r.name])),
      trackNames: new Map(trackRows.map((r) => [r.id, r.name])),
    };

    return rows.map((row) => describeAuditEntry(row, lookups));
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hackpulse/api exec jest audit.service -- --no-coverage`
Expected: PASS, including the pre-existing `verifyChain` tests (unchanged) and the two new `list` tests

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit/audit.service.ts apps/api/src/audit/audit.service.spec.ts
git commit -m "feat(audit): resolve names and human labels in AuditService.list()"
```

---

## Task 3: FR-ROLE-06 — log denied score access

**Files:**

- Modify: `apps/api/src/judging/guards/assignment-ownership.guard.ts`
- Test: `apps/api/src/judging/guards/assignment-ownership.guard.spec.ts`

**Interfaces:**

- Consumes: `AuditService` (existing, from `../../audit/audit.service`; already a provider in `JudgingModule`, which already imports `AuditModule` — no module wiring change needed).

**Note:** `assignment-ownership.guard.spec.ts` currently constructs `new AssignmentOwnershipGuard(makeDb(...))` with one argument in 8 existing tests, and its `makeDb` helper builds `{ id, eventId, judgeUserId }` assignments with no `submissionId` field. Since the guard's constructor is gaining a required second parameter and the audit call needs `assignment.submissionId`, this task replaces the whole spec file rather than patching it piecemeal.

- [ ] **Step 1: Replace the whole spec file with the failing version**

```typescript
// apps/api/src/judging/guards/assignment-ownership.guard.spec.ts — full new contents
import type { CurrentUser } from "@hackpulse/shared";
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import type { AuditService } from "../../audit/audit.service";
import type { Database } from "../../db/client";
import { AssignmentOwnershipGuard } from "./assignment-ownership.guard";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const ASSIGNMENT_ID = "22222222-2222-2222-2222-222222222222";

function makeDb(
  assignment:
    { id: string; eventId: string; judgeUserId: string; submissionId?: string } | undefined,
) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(assignment ? [assignment] : []),
      }),
    }),
  } as unknown as Database;
}

function makeAudit(): { log: jest.Mock } & AuditService {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as {
    log: jest.Mock;
  } & AuditService;
}

function makeContext(user: CurrentUser | null): ExecutionContext {
  const request = { user, params: { assignmentId: ASSIGNMENT_ID } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function judge(id: string): CurrentUser {
  return {
    id,
    email: `${id}@example.com`,
    name: "Judge",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: false,
    eventRoles: [{ eventId: EVENT_A, role: "judge" }],
  };
}

describe("AssignmentOwnershipGuard", () => {
  it("denies an unauthenticated caller", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(null))).rejects.toThrow(UnauthorizedException);
  });

  it("404s a nonexistent assignment rather than leaking a filtered result", async () => {
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("denies a different judge's assignment — the core isolation property", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(judge("judge-b")))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("logs a score.access_denied entry when a judge is refused another judge's assignment", async () => {
    const audit = makeAudit();
    const guard = new AssignmentOwnershipGuard(
      makeDb({
        id: ASSIGNMENT_ID,
        eventId: EVENT_A,
        judgeUserId: "judge-a",
        submissionId: "sub-1",
      }),
      audit,
    );
    await expect(guard.canActivate(makeContext(judge("judge-b")))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.log).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorUserId: "judge-b",
      action: "score.access_denied",
      resourceType: "judge_assignment",
      resourceId: ASSIGNMENT_ID,
      metadata: { submissionId: "sub-1" },
    });
  });

  it("does not log anything when the assignment doesn't exist", async () => {
    const audit = makeAudit();
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), audit);
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      NotFoundException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("allows the assigned judge", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(judge("judge-a")))).resolves.toBe(true);
  });

  it("allows the event's organizer even though they are not the assigned judge", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const organizer: CurrentUser = {
      ...judge("org-a"),
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(organizer))).resolves.toBe(true);
  });

  // Admin bypass reversed: isAdmin alone must not skip the
  // existence/ownership check.
  it("does not let a global admin bypass a nonexistent assignment", async () => {
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), makeAudit());
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin))).rejects.toThrow(NotFoundException);
  });

  it("denies a global admin who is neither the assigned judge nor that event's organizer", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin))).rejects.toThrow(ForbiddenException);
  });

  it("still allows a global admin who also organizes this event", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const admin: CurrentUser = {
      ...judge("admin-a"),
      isAdmin: true,
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(admin))).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter @hackpulse/api exec jest assignment-ownership -- --no-coverage`
Expected: FAIL — `AssignmentOwnershipGuard` only accepts one constructor argument today; the two new tests (and every existing one, now called with a second argument) fail to construct

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/judging/guards/assignment-ownership.guard.ts — full new contents
import type { CurrentUser } from "@hackpulse/shared";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import { AuditService } from "../../audit/audit.service";
import { isEventOrganizer } from "../../common/auth/is-event-organizer";
import type { Database } from "../../db/client";
import { judgeAssignments } from "../../db/schema";
import { DB } from "../../db/tokens";

interface RequestLike {
  user: CurrentUser | null;
  params: Record<string, string>;
}

/**
 * FR-ROLE-02/03/05 — a score/assignment route is reachable only by the
 * judge it was assigned to, or an organizer/admin of that event. Since
 * assignments are only ever created within a judge's scoped track
 * (AssignmentsService), ownership of the assignment *is* track scope
 * here. A mismatch is 403 for an authenticated stranger, 404 for a
 * nonexistent assignment, never a filtered/empty success.
 *
 * FR-ROLE-06: the 403 branch below is itself a "deny" decision on a
 * sensitive resource (scores) and must be auditable, same as the 200
 * path already is via ScoringService. The 404 branch isn't logged: there's
 * no existing sensitive resource to have made a decision about yet.
 */
@Injectable()
export class AssignmentOwnershipGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const assignmentId = request.params.assignmentId;
    const [assignment] = await this.db
      .select()
      .from(judgeAssignments)
      .where(eq(judgeAssignments.id, assignmentId));

    if (!assignment) {
      throw new NotFoundException();
    }

    // isAdmin deliberately does not bypass this anymore — see
    // is-event-organizer.ts. Only an actual organizer role on *this*
    // assignment's event, or being the assigned judge, grants access.
    if (isEventOrganizer(user, assignment.eventId)) {
      return true;
    }

    if (assignment.judgeUserId !== user.id) {
      await this.audit.log({
        eventId: assignment.eventId,
        actorUserId: user.id,
        action: "score.access_denied",
        resourceType: "judge_assignment",
        resourceId: assignmentId,
        metadata: { submissionId: assignment.submissionId },
      });
      throw new ForbiddenException();
    }

    return true;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hackpulse/api exec jest assignment-ownership -- --no-coverage`
Expected: PASS, all 10 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/judging/guards/assignment-ownership.guard.ts apps/api/src/judging/guards/assignment-ownership.guard.spec.ts
git commit -m "fix(audit): log denied score access per FR-ROLE-06"
```

---

## Task 4: FR-ROLE-06 — log denied track-scope access

**Files:**

- Modify: `apps/api/src/judging/guards/track-scope.guard.ts`
- Test: `apps/api/src/judging/guards/track-scope.guard.spec.ts`

**Interfaces:**

- Consumes: `AuditService` (same as Task 3).

**Note:** `track-scope.guard.spec.ts` currently constructs `new TrackScopeGuard(makeJudgeTrackScope(...))` with one argument in 8 existing tests. Since the guard's constructor is gaining a required second parameter, this task replaces the whole spec file rather than patching it piecemeal.

- [ ] **Step 1: Replace the whole spec file with the failing version**

```typescript
// apps/api/src/judging/guards/track-scope.guard.spec.ts — full new contents
import type { CurrentUser } from "@hackpulse/shared";
import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";

import type { AuditService } from "../../audit/audit.service";
import type { JudgeTrackScopeService } from "../../common/judge-track-scope.service";
import { TrackScopeGuard } from "./track-scope.guard";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const TRACK_A = "22222222-2222-2222-2222-222222222222";
const TRACK_B = "33333333-3333-3333-3333-333333333333";

function makeJudgeTrackScope(scopedTrackIds: string[]) {
  return {
    isScoped: jest.fn((_eventId: string, _judgeUserId: string, trackId: string) =>
      Promise.resolve(scopedTrackIds.includes(trackId)),
    ),
  } as unknown as JudgeTrackScopeService;
}

function makeAudit(): { log: jest.Mock } & AuditService {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as {
    log: jest.Mock;
  } & AuditService;
}

function makeContext(
  user: CurrentUser | null,
  trackSource: { params?: string; query?: string; body?: string } = {},
): ExecutionContext {
  const request = {
    user,
    params: { eventId: EVENT_A, ...(trackSource.params ? { trackId: trackSource.params } : {}) },
    query: trackSource.query ? { trackId: trackSource.query } : {},
    body: trackSource.body ? { trackId: trackSource.body } : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function judge(id: string): CurrentUser {
  return {
    id,
    email: `${id}@example.com`,
    name: "Judge",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: false,
    eventRoles: [{ eventId: EVENT_A, role: "judge" }],
  };
}

describe("TrackScopeGuard", () => {
  it("denies an unauthenticated caller", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(null, { query: TRACK_A }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("denies when no trackId is present anywhere on the request", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("denies a judge not scoped to the requested track: the core isolation property", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { query: TRACK_B })),
    ).rejects.toThrow(ForbiddenException);
  });

  it("logs a track_scope.access_denied entry when a judge is out of scope for the track", async () => {
    const audit = makeAudit();
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), audit);
    await expect(
      guard.canActivate(makeContext(judge("judge-b"), { query: TRACK_B })),
    ).rejects.toThrow(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorUserId: "judge-b",
      action: "track_scope.access_denied",
      resourceType: "track",
      resourceId: TRACK_B,
    });
  });

  it("does not log anything when no trackId is present on the request", async () => {
    const audit = makeAudit();
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), audit);
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("allows a judge scoped to the requested track", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { query: TRACK_A })),
    ).resolves.toBe(true);
  });

  it("resolves trackId from a route param when present", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { params: TRACK_A })),
    ).resolves.toBe(true);
  });

  it("resolves trackId from the request body when not in params or query", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a"), { body: TRACK_A }))).resolves.toBe(
      true,
    );
  });

  it("allows the event's organizer regardless of judge_track_scopes", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([]), makeAudit()); // not scoped to anything
    const organizer: CurrentUser = {
      ...judge("org-a"),
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(organizer, { query: TRACK_A }))).resolves.toBe(true);
  });

  // Same posture as AssignmentOwnershipGuard: isAdmin alone is not an
  // automatic bypass, only an actual organizer role on *this* event is.
  it("denies a global admin who is neither scoped nor this event's organizer", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([]), makeAudit());
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin, { query: TRACK_A }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter @hackpulse/api exec jest track-scope -- --no-coverage`
Expected: FAIL — `TrackScopeGuard` only accepts one constructor argument today

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/judging/guards/track-scope.guard.ts — full new contents
import type { CurrentUser } from "@hackpulse/shared";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import { AuditService } from "../../audit/audit.service";
import { isEventOrganizer } from "../../common/auth/is-event-organizer";
import { JudgeTrackScopeService } from "../../common/judge-track-scope.service";

interface RequestLike {
  user: CurrentUser | null;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown> | undefined;
}

/**
 * FR-ROLE-02/03/05, ARCHITECTURE.md §6: for judge-role routes keyed by
 * :eventId plus a trackId that isn't part of an owned resource
 * AssignmentOwnershipGuard could resolve (pairwise's next/compare, which
 * act on a track directly rather than an :assignmentId). Resolves the
 * caller's judge_track_scopes row for this track before the handler runs.
 * Same posture as other isolation checks here: absence of a scope row is
 * a deny, and the same organizer-bypass rule as AssignmentOwnershipGuard
 * (an organizer of *this* event always passes; isAdmin alone does not,
 * see is-event-organizer.ts).
 *
 * FR-ROLE-06: the out-of-scope 403 below is a deny decision on a sensitive
 * (judging) resource and must be auditable. The missing-trackId 403 above
 * it isn't logged — that's a malformed request, not a decision about an
 * actual resource.
 */
@Injectable()
export class TrackScopeGuard implements CanActivate {
  constructor(
    private readonly judgeTrackScope: JudgeTrackScopeService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }

    const eventId = request.params.eventId;
    const trackId =
      request.params.trackId ??
      (request.query?.trackId as string | undefined) ??
      (request.body?.trackId as string | undefined);
    if (!trackId) {
      throw new ForbiddenException();
    }

    if (isEventOrganizer(user, eventId)) {
      return true;
    }

    const scoped = await this.judgeTrackScope.isScoped(eventId, user.id, trackId);
    if (!scoped) {
      await this.audit.log({
        eventId,
        actorUserId: user.id,
        action: "track_scope.access_denied",
        resourceType: "track",
        resourceId: trackId,
      });
      throw new ForbiddenException();
    }
    return true;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hackpulse/api exec jest track-scope -- --no-coverage`
Expected: PASS, all 10 tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/judging/guards/track-scope.guard.ts apps/api/src/judging/guards/track-scope.guard.spec.ts
git commit -m "fix(audit): log denied track-scope access per FR-ROLE-06"
```

---

## Task 5: FR-ROLE-06 — log denied audit-log access (both controllers)

**Files:**

- Modify: `apps/api/src/audit/audit.controller.ts`
- Test: Create `apps/api/src/audit/audit.controller.spec.ts`

**Interfaces:**

- Consumes: `AuditService` (already injected in both controllers).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/audit/audit.controller.spec.ts
import { ForbiddenException } from "@nestjs/common";
import type { CurrentUser } from "@hackpulse/shared";

import { AuditController, AuditGlobalController } from "./audit.controller";
import type { AuditService } from "./audit.service";

function organizer(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "organizer-1",
    email: "organizer-1@example.com",
    name: "Organizer",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: true,
    eventRoles: [{ eventId: "event-1", role: "organizer" }],
    ...overrides,
  };
}

describe("AuditController.list", () => {
  it("logs audit_log.access_denied and throws for a non-organizer, non-admin caller", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(audit);
    const stranger = organizer({ id: "stranger-1", eventRoles: [] });

    await expect(
      controller.list("event-1", undefined, undefined, undefined, undefined, stranger),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith({
      eventId: "event-1",
      actorUserId: "stranger-1",
      action: "audit_log.access_denied",
      resourceType: "event",
      resourceId: "event-1",
    });
    expect(audit.list).not.toHaveBeenCalled();
  });

  it("does not log when the caller is the event's organizer", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = {
      log: auditLog,
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as AuditService;
    const controller = new AuditController(audit);

    await controller.list("event-1", undefined, undefined, undefined, undefined, organizer());
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("AuditGlobalController.list", () => {
  it("logs audit_log.access_denied to the GLOBAL partition for a non-admin caller", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditGlobalController(audit);

    await expect(
      controller.list(undefined, undefined, undefined, undefined, organizer()),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith({
      eventId: null,
      actorUserId: "organizer-1",
      action: "audit_log.access_denied",
      resourceType: "instance",
      resourceId: "GLOBAL",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hackpulse/api exec jest audit.controller -- --no-coverage`
Expected: FAIL — `auditLog` never called, methods aren't `async` yet so the rejection assertion may also fail to resolve as expected

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/audit/audit.controller.ts — full new contents
import type { CurrentUser as CurrentUserType } from "@hackpulse/shared";
import { Controller, ForbiddenException, Get, Param, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/current-user.decorator";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import { Public } from "../common/decorators/public.decorator";
import { AuditService } from "./audit.service";

@Controller("events/:eventId/audit-log")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // Deliberately not @Roles("organizer"): admin gets a read-only bypass
  // here, the oversight capability needed to investigate a dispute without
  // full organizer control over someone else's event.
  // FR-ROLE-06: the 403 below is a deny decision on a sensitive resource
  // (the audit log itself) and must be auditable, same as any other.
  @Get()
  async list(
    @Param("eventId") eventId: string,
    @Query("since") since: string | undefined,
    @Query("action") action: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!isEventOrganizer(user, eventId) && !user.isAdmin) {
      await this.audit.log({
        eventId,
        actorUserId: user.id,
        action: "audit_log.access_denied",
        resourceType: "event",
        resourceId: eventId,
      });
      throw new ForbiddenException();
    }
    return this.audit.list(eventId, {
      since: since ? new Date(since) : undefined,
      action,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Public by design (matches GET /verify/judge-record/:id): a hash-chain
  // audit log's whole point is independent verification, without trusting
  // the server's say-so, and an organizer-only gate would let a tampering
  // organizer just never run the check. The response carries no row
  // content or actor PII, only valid/brokenAt/reason.
  @Get("verify")
  @Public()
  verify(@Param("eventId") eventId: string) {
    return this.audit.verifyChain(eventId);
  }
}

// The GLOBAL partition (auth, admin capability grants) is admin-only,
// not the organizer-or-admin posture the per-event routes above use: no
// per-event organizer has a claim to see instance-wide auth events.
// Separate controller since AuditController's route is fixed to
// events/:eventId/... and "global" isn't an eventId.
@Controller("audit-log/global")
export class AuditGlobalController {
  constructor(private readonly audit: AuditService) {}

  // FR-ROLE-06: same reasoning as AuditController.list above, logged to
  // the GLOBAL partition (eventId: null) since there's no event to scope it to.
  @Get()
  async list(
    @Query("since") since: string | undefined,
    @Query("action") action: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!user.isAdmin) {
      await this.audit.log({
        eventId: null,
        actorUserId: user.id,
        action: "audit_log.access_denied",
        resourceType: "instance",
        resourceId: "GLOBAL",
      });
      throw new ForbiddenException();
    }
    return this.audit.list(null, {
      since: since ? new Date(since) : undefined,
      action,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Not @Public() like the per-event verify: entriesChecked reveals
  // instance-wide activity, not any one organizer's event.
  @Get("verify")
  async verify(@CurrentUser() user: CurrentUserType) {
    if (!user.isAdmin) {
      await this.audit.log({
        eventId: null,
        actorUserId: user.id,
        action: "audit_log.access_denied",
        resourceType: "instance",
        resourceId: "GLOBAL",
      });
      throw new ForbiddenException();
    }
    return this.audit.verifyChain(null);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @hackpulse/api exec jest audit.controller -- --no-coverage`
Expected: PASS, all 3 new tests green

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/audit/audit.controller.ts apps/api/src/audit/audit.controller.spec.ts
git commit -m "fix(audit): log denied audit-log access per FR-ROLE-06"
```

---

## Task 6: Organizer dashboard — render the readable fields

**Files:**

- Modify: `apps/web/app/events/[eventId]/organizer/page.tsx:201-208` (interface), `:2107-2132` (table)

**Interfaces:**

- Consumes: the enriched shape from Task 2 — `actorName`, `actionLabel`, `resourceLabel` now present on every item `GET /events/:eventId/audit-log` returns.

This page has no existing frontend test harness (no `*.spec.tsx`/e2e file references it in this repo), so this task is verified manually per its Step 3 below rather than with an automated test — consistent with how the rest of this file's UI is validated elsewhere in the codebase.

- [ ] **Step 1: Update the `AuditEntry` interface**

```typescript
// apps/web/app/events/[eventId]/organizer/page.tsx — replace lines 201-208
interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  actionLabel: string;
  resourceType: string;
  resourceId: string;
  resourceLabel: string;
  createdAt: string;
}
```

- [ ] **Step 2: Update the audit-log table body**

```tsx
{
  /* apps/web/app/events/[eventId]/organizer/page.tsx — replace the <tbody> block at lines 2116-2130 */
}
<tbody>
  {auditEntries.map((a) => (
    <tr key={a.id} className="border-t border-line">
      <td className="py-1 text-xs text-muted">{new Date(a.createdAt).toLocaleString()}</td>
      <td className="py-1">{a.actionLabel}</td>
      <td className="py-1 text-xs text-muted">{a.resourceLabel}</td>
      <td className="py-1 text-xs text-muted">{a.actorName}</td>
    </tr>
  ))}
</tbody>;
```

- [ ] **Step 3: Verify manually against the running stack**

Run: `docker compose up -d api web` (if not already running), then:

```bash
ORG_COOKIE=$(grep '^organizer' .dogfood.toml | sed -E 's/.*Cookie: (.*)"/\1/')
curl -s "http://localhost:3001/api/v1/events/d06f00d0-0000-4000-8000-000000000000/audit-log?limit=3" -H "Cookie: $ORG_COOKIE" | python3 -m json.tool
```

Expected: each item now has non-null `actorName`, `actionLabel`, `resourceLabel` fields alongside the original raw ones. Then open `http://localhost:3000/events/d06f00d0-0000-4000-8000-000000000000/organizer` signed in as `dogfood-organizer@hackpulse.local`, go to the **Data** tab, and confirm the Audit log table shows names and plain-English actions instead of truncated ids and dot-codes.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/events/[eventId]/organizer/page.tsx"
git commit -m "feat(audit): render readable actor/action/resource in the dashboard audit table"
```

---

## Task 7: Admin audit log page

**Files:**

- Create: `apps/web/app/admin/audit-log/page.tsx`

**Interfaces:**

- Consumes: `GET /audit-log/global` + `GET /audit-log/global/verify` (no eventId), or `GET /events/:eventId/audit-log` + `GET /events/:eventId/audit-log/verify` (eventId from `?eventId=` search param) — both already return the Task 2 enriched shape. `useAuth()` from `../../../lib/auth-context` for `user.isAdmin`. `api`, `ApiError` from `../../../lib/api`.

- [ ] **Step 1: Write the page**

```tsx
// apps/web/app/admin/audit-log/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { LoadingState } from "../../../components/ui";
import { api, ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  actionLabel: string;
  resourceType: string;
  resourceId: string;
  resourceLabel: string;
  createdAt: string;
}

interface VerifyResult {
  valid: boolean;
  brokenAt?: string;
  reason?: string;
  entriesChecked?: number;
}

// REQUIREMENTS.md's Admin role is defined with "full audit access" — this
// is that surface. It reads whichever partition the backend's own
// isAdmin bypass already allows (AuditController/AuditGlobalController):
// a specific event's log via ?eventId=, or the instance-wide GLOBAL
// partition with no query param. There's no organizer-dashboard route
// into this: an admin who doesn't organize the event is deliberately
// blocked from that whole page (see its own isOrganizer gate), so this
// is the only UI path to the per-event bypass the backend already grants.
export default function AdminAuditLogPage() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.isAdmin) {
      return;
    }
    const base = eventId ? `/events/${eventId}/audit-log` : "/audit-log/global";
    setError(null);
    setLoaded(false);
    api
      .get<{ items: AuditEntry[] }>(base)
      .then((r) => setEntries(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load the audit log"))
      .finally(() => setLoaded(true));
    api
      .get<VerifyResult>(`${base}/verify`)
      .then(setVerify)
      .catch(() => setVerify(null));
  }, [user?.isAdmin, eventId]);

  if (authLoading) {
    return <LoadingState />;
  }
  if (!user?.isAdmin) {
    return (
      <div className="max-w-md">
        <h1 className="text-h1 font-semibold text-ink">Audit log</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Only an instance admin can view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-h1 font-semibold text-ink">
        {eventId ? "Event audit log" : "Instance-wide audit log"}
      </h1>
      <p className="mt-1 text-xs leading-normal text-muted">
        {eventId
          ? "This event's own append-only log, read via admin oversight access."
          : "Site-wide actions with no single event of their own (auth, admin capability grants)."}
      </p>

      {error && (
        <p data-testid="admin-audit-error" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {verify && (
        <p
          data-testid="admin-audit-verify-status"
          className={`mt-3 text-xs ${verify.valid ? "text-success" : "text-danger"}`}
        >
          {verify.valid
            ? "Chain verified. No tampering detected."
            : `Chain broken at entry ${verify.brokenAt} (${verify.reason}).`}
        </p>
      )}

      {!loaded ? (
        <LoadingState className="mt-6" />
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">No audit entries yet.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="pb-1">When</th>
              <th className="pb-1">Action</th>
              <th className="pb-1">Resource</th>
              <th className="pb-1">Actor</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-line">
                <td className="py-1 text-xs text-muted">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="py-1">{entry.actionLabel}</td>
                <td className="py-1 text-xs text-muted">{entry.resourceLabel}</td>
                <td className="py-1 text-xs text-muted">{entry.actorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify manually against the running stack**

With `docker compose up -d api web` running, register a brand-new account (it becomes admin per this instance's own bootstrap rule), sign in, then visit:

- `http://localhost:3000/admin/audit-log` — should show the instance-wide (GLOBAL) log, or "No audit entries yet." if empty.
- `http://localhost:3000/admin/audit-log?eventId=d06f00d0-0000-4000-8000-000000000000` — should show the fixture event's own audit log with readable names/actions, even though this admin account never organizes that event.

Then sign in as a non-admin account and confirm `/admin/audit-log` shows the "Only an instance admin can view this page" message, not a crash or blank page.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/audit-log/page.tsx
git commit -m "feat(audit): add admin-only audit log page (global and per-event)"
```

---

## Task 8: Entry points to the admin audit page

**Files:**

- Modify: `apps/web/components/nav.tsx` (global link)
- Modify: `apps/web/app/events/[eventId]/page.tsx:252-259` (per-event link)

**Interfaces:**

- Consumes: Task 7's `/admin/audit-log` route. `user.isAdmin` from `useAuth()` (already destructured in both files).

- [ ] **Step 1: Add the global nav link**

```tsx
{
  /* apps/web/components/nav.tsx — insert directly after the "Certificates" Link (after line 217), still inside the `user ? (` branch */
}
{
  user.isAdmin && (
    <Link
      href="/admin/audit-log"
      className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-surface-alt hover:text-ink"
    >
      Audit log
    </Link>
  );
}
```

- [ ] **Step 2: Add the per-event link for a non-organizing admin**

```tsx
{
  /* apps/web/app/events/[eventId]/page.tsx — insert directly after the "Organizer dashboard" Link block (after line 259), still inside the surrounding <div className="flex flex-wrap gap-2"> */
}
{
  user?.isAdmin && !isOrganizer && (
    <Link
      href={`/admin/audit-log?eventId=${eventId}`}
      className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm font-medium hover:bg-surface-alt"
    >
      Audit log (admin)
    </Link>
  );
}
```

- [ ] **Step 3: Verify manually**

With the stack running and signed in as an admin who does **not** organize the fixture event (e.g. a freshly registered second account, or the bootstrap admin before self-assigning as the fixture event's organizer): confirm the nav bar shows an "Audit log" link going to `/admin/audit-log`, and the fixture event's page (`/events/d06f00d0-0000-4000-8000-000000000000`) shows an "Audit log (admin)" button going to `/admin/audit-log?eventId=d06f00d0-0000-4000-8000-000000000000`. Confirm neither link appears when signed in as a non-admin participant/judge account.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/nav.tsx "apps/web/app/events/[eventId]/page.tsx"
git commit -m "feat(audit): link to the admin audit log page from nav and event pages"
```

---

## Final verification (after Task 8)

- [ ] Run the full API test suite: `pnpm --filter @hackpulse/api run test` — expect no regressions beyond the intentionally-updated guard/controller specs.
- [ ] Re-run the DOGFOOD acceptance checker to confirm nothing in the existing contract broke: `python3 run.py .dogfood.toml` (refresh `.dogfood.toml`'s `[auth]` cookies first if the stack has been restarted since they were last pasted — see `docker compose logs api | grep -A6 "Test logins"`). Expect the same T1/T2 PASS results as before this work started.
- [ ] Manually trigger one denial of each new kind and confirm it shows up readably: have `dogfood-judge-b@hackpulse.local` `GET /judging/scores/d06f00d0-0000-4000-8000-00000000a001` (judge_a's assignment) and confirm a `score.access_denied` / "Blocked — tried to view another judge's score" row appears in that event's audit log afterward.
