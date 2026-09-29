# HackPulse: API Design

The executable contract lives in `docs/openapi.yaml` (OpenAPI 3.0, auto-generated, see §4): this document covers the conventions that apply across it and a route-by-route map to the requirements in `REQUIREMENTS.md`. Every action available in the UI exists here (FR-API-01); `web` is just the first client of it.

## 1. Conventions

- **Base path**: `/api/v1`. Breaking changes get `/api/v2`; the old version stays live until nothing depends on it.
- **Auth**: session cookie (`hackpulse.session_token`, httpOnly/secure/sameSite=lax), issued by `POST /auth/sign-in/email`. There is no bearer-token API auth in v1: third-party integrations authenticate as a real user (e.g., a service account with the `organizer` role) via the same session flow, or via a scoped **API key** (`Authorization: Bearer tk_live_...`) issued per-event for webhook/export automation. API keys carry the same role/scope as the user who issued them and are revocable.
- **CSRF**: required on all cookie-authenticated mutating requests via `X-CSRF-Token`, issued at login and validated against the session. Not required for API-key authenticated requests (no ambient browser credential to forge).
- **Error envelope** (all non-2xx):
  ```json
  { "error": { "code": "FORBIDDEN", "message": "human-readable", "requestId": "uuid" } }
  ```
  `code` is a stable machine-readable string (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `DEADLINE_PASSED`, `CONFLICT`, `RATE_LIMITED`). `403` bodies never reveal whether a resource exists beyond the caller's own authorization (FR-ROLE-05).
- **Pagination**: cursor-based on list endpoints: `?limit=50&cursor=...`, response includes `nextCursor: string | null`. Chosen over offset pagination because audit-log and score lists are append-heavy and offset pagination drifts under concurrent writes.
- **Rate limiting**: `429` with `Retry-After`; limits vary per endpoint class (auth, voting, comments; see FR-ABUSE-01) and are documented per-operation in the spec via the `x-rate-limit` extension.
- **Idempotency**: webhook delivery and bulk-import row processing accept an `Idempotency-Key` header; replays with the same key return the original result rather than reprocessing.
- **Timestamps**: always ISO-8601 UTC on the wire (`2026-09-27T18:29:00Z`); the client localizes for display (NFR-UX-01).

## 2. Route Map

Legend for **Role**: `-` = any (including visitor), `P` = participant (team member), `J` = judge, `O` = organizer, `A` = admin. Roles are additive left-to-right (`O,A` means organizer or admin).

### Auth (`/auth`): FR-AUTH

`/auth/*` is owned entirely by Better Auth (ADR-005), mounted directly on the underlying Fastify instance rather than as Nest controllers, since its route surface is generated from its own config rather than hand-declared DTOs (see `main.ts`). These are Better Auth's native paths, not a custom shape:

| Method & Path                                         | Role              | Notes                                               |
| ----------------------------------------------------- | ----------------- | --------------------------------------------------- |
| POST `/auth/sign-up/email`                            | -                 | rate-limited; issues the session cookie on success  |
| POST `/auth/sign-in/email`                            | -                 | rate-limited per account+IP (FR-AUTH-05)            |
| POST `/auth/sign-out`                                 | any authenticated | revokes current session                             |
| GET `/auth/get-session`                               | -                 | returns `null` (200) if no valid session, not a 401 |
| POST `/auth/forget-password` / `/auth/reset-password` | -                 | password reset flow (FR-AUTH-06)                    |

`GET /users/me` (a real Nest controller, not Better Auth's) is the one that returns our own `CurrentUser` shape: session user plus this account's event-scoped roles resolved from `event_roles` (FR-ROLE). Every other route in the API is authenticated through the session cookie Better Auth issues here; `AuthGuard` (global) calls `auth.api.getSession()` on every request and populates `request.user` before `RolesGuard` runs.

### Events (`/events`): FR-EVT

| Method & Path                                   | Role              | Notes                                                                                                                                                                                               |
| ----------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/events`                                  | any authenticated | creator becomes `organizer`                                                                                                                                                                         |
| GET `/events`                                   | -                 | draft events hidden from non-members; `?phase=active\|past\|mine` filters the list; an automatic-mode draft becomes visible on its own once `registrationOpenAt` passes, no organizer action needed |
| GET `/events/:eventId`                          | -                 | same visibility rule as the list above; gallery visibility (open, participants_only, hidden) is a separate, narrower setting on top, see the gallery routes below                                   |
| PATCH `/events/:eventId`                        | O,A               | structural-change constraints (FR-EVT-03)                                                                                                                                                           |
| POST `/events/:eventId/tracks`                  | O,A               |                                                                                                                                                                                                     |
| PATCH/DELETE `/events/:eventId/tracks/:trackId` | O,A               |                                                                                                                                                                                                     |
| POST `/events/:eventId/prizes`                  | O,A               | `winnerCount` defaults to 1                                                                                                                                                                         |
| PATCH/DELETE `/events/:eventId/prizes/:prizeId` | O,A               |                                                                                                                                                                                                     |
| POST `/events/:eventId/custom-questions`        | O,A               |                                                                                                                                                                                                     |
| POST `/events/:eventId/organizers`              | O,A               | grant organizer role                                                                                                                                                                                |
| POST `/events/:eventId/judges`                  | O,A               | invite + scope to tracks, FR-JASSIGN-01                                                                                                                                                             |

### Teams (`/events/:eventId/teams`): FR-TEAM

| Method & Path                           | Role                  | Notes                       |
| --------------------------------------- | --------------------- | --------------------------- |
| POST                                    | P (any authenticated) | creates team, becomes owner |
| GET `/teams/:teamId`                    | P (own), O,A          |                             |
| POST `/teams/:teamId/invite/regenerate` | owner                 |                             |
| POST `/teams/join` `{ inviteCode }`     | any authenticated     | FR-TEAM-02                  |
| DELETE `/teams/:teamId/members/:userId` | owner, O,A            |                             |

### Submissions (`/events/:eventId/submissions`): FR-SUB

| Method & Path                    | Role                       | Notes                                      |
| -------------------------------- | -------------------------- | ------------------------------------------ |
| POST                             | P (team owner/member)      | creates draft                              |
| PATCH `/submissions/:id`         | P (own team)               | rejected after deadline, `DEADLINE_PASSED` |
| POST `/submissions/:id/submit`   | P (own team)               | locks version for judging                  |
| GET `/submissions/:id`           | P (own), J (assigned), O,A |                                            |
| GET `/submissions/:id/revisions` | O,A                        | FR-SUB-04                                  |

### Gallery (`/events/:eventId/gallery`): FR-GAL

| Method & Path                              | Role               | Notes                                                                                |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------ |
| GET `/gallery?search=&track=&tag=&cursor=` | - (per visibility) | 404 if the event itself isn't visible yet, regardless of `gallery_visibility`        |
| GET `/gallery/widget`                      | -                  | embeddable, FR-WIDGET-01, CORS-open, cacheable; same event-visibility check as above |

### Judging (`/events/:eventId/judging`): FR-JASSIGN, FR-SCORE

| Method & Path                               | Role                    | Notes                                                                 |
| ------------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| POST `/judging/assignments`                 | O,A                     | manual batch or `{ strategy: "algorithmic", minJudgesPerSubmission }` |
| GET `/judging/queue`                        | J                       | only this judge's assignments                                         |
| POST `/judging/rubrics`                     | O,A                     | criteria weights must sum to 1.0                                      |
| PUT `/judging/scores/:assignmentId`         | J (own assignment only) | draft save                                                            |
| POST `/judging/scores/:assignmentId/submit` | J (own assignment only) | locks raw score, triggers normalization job                           |
| GET `/judging/scores/:assignmentId`         | J (own only), O,A       | **403, not filtered, for another judge's assignment** (FR-ROLE-02)    |
| GET `/judging/progress`                     | O,A                     | FR-DASH-01                                                            |

### Pairwise (`/events/:eventId/pairwise`): FR-PAIR

| Method & Path                      | Role                      | Notes                                                                                  |
| ---------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| GET `/pairwise/next`               | J                         | server selects the pair; 409 once every pair is compared                               |
| POST `/pairwise/compare`           | J                         | `{ submissionA, submissionB, winner }`, 409 on a repeat of the same pair               |
| GET `/pairwise/rankings`           | O,A (public post-publish) | includes confidence interval                                                           |
| GET `/pairwise/progress`           | J                         | self scoped, pairs not yet compared per track, drives the pending judging notification |
| GET `/pairwise/organizer-progress` | O,A                       | every judge, every track, the pairwise analog of the rubric progress table             |

### Results (`/events/:eventId/results`): FR-RESULT, FR-NORM

| Method & Path                      | Role                                         | Notes                                          |
| ---------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| GET `/results/preview`             | O,A                                          | pre-publish view                               |
| POST `/results/publish`            | O,A                                          | flips visibility gate                          |
| GET `/results`                     | - (only after publish, per `NFR` visibility) |                                                |
| GET `/results/normalization-proof` | O,A                                          | raw vs normalized vs rank-delta table, FR-NORM |

### Voting & Comments: FR-VOTE, FR-COMMENT

| Method & Path                      | Role                                 | Notes                                                                |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| POST `/events/:eventId/votes`      | per `voting_access`                  | `{ submissionId, votes }`; server enforces quadratic cost if enabled |
| GET `/events/:eventId/votes/tally` | O,A only during window; public after | FR-RESULT-02                                                         |
| POST `/submissions/:id/comments`   | per configured access                |                                                                      |
| DELETE `/comments/:id`             | author, O,A                          | soft delete                                                          |

### Export / Import (`/events/:eventId/export`, `/import`): FR-EXP, FR-BULK

| Method & Path                           | Role                              | Notes                                                                                                                                                              |
| --------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/export/{resource}.csv` or `.json` | O,A (scoped to what they can see) | resource ∈ registrations, teams, submissions, assignments, scores, normalized-results, votes, audit-log; format picked by the file extension, same rows either way |
| GET `/export/archive`                   | O,A                               | full-event JSON archive only, FR-BULK-02                                                                                                                           |
| POST `/import/archive`                  | O,A                               | JSON only; round-trips with the above; always creates a brand-new event, never modifies an existing one                                                            |
| POST `/import/{resource}`               | O,A                               | body is `{ csv: string }` or `{ json: object[] }`; per-row validation report either way                                                                            |

### Certificates (`/events/:eventId/certificates`): FR-CERT

| Method & Path                  | Role           | Notes                                  |
| ------------------------------ | -------------- | -------------------------------------- |
| POST `/certificates/generate`  | O,A            | `{ type, recipientIds[] }`, queued job |
| GET `/certificates/:id`        | recipient, O,A |                                        |
| GET `/verify/judge-record/:id` | -              | public, no auth: signature check only  |

### Audit Log (`/events/:eventId/audit-log`): FR-ABUSE-05

| Method & Path                   | Role | Notes                                 |
| ------------------------------- | ---- | ------------------------------------- |
| GET `/audit-log?since=&action=` | O,A  | append-only, no write endpoints exist |

### Webhooks (`/events/:eventId/webhooks`): FR-API-03

| Method & Path                              | Role | Notes                                                            |
| ------------------------------------------ | ---- | ---------------------------------------------------------------- |
| POST                                       | O,A  | `{ targetUrl, subscribedEvents[] }`, returns signing secret once |
| GET `/webhooks/:id/deliveries`             | O,A  | delivery attempts + status                                       |
| POST `/webhooks/:id/redeliver/:deliveryId` | O,A  | manual retry                                                     |

## 3. Webhook Payloads

Signed with HMAC-SHA256 over the raw body using the webhook's secret, sent as `X-HackPulse-Signature`. Event types: `submission.received`, `judging.completed` (per-submission, all assignments done), `results.published`, `certificate.issued`. Delivery retries with exponential backoff (5 attempts) and is logged to `webhook_deliveries`, visible via the API above.

## 4. Schema Source of Truth

Request/response DTOs are Zod schemas in `packages/shared`, consumed by NestJS (`ZodValidationPipe`) for runtime validation. `docs/openapi.yaml` is generated, not hand-maintained: `apps/api/src/openapi/setup.ts` builds the document straight from the live controllers (`@nestjs/swagger`'s reflection, not a Zod-to-OpenAPI conversion; DTOs are Zod, not `class-validator` classes, so Swagger sees route/parameter shape but not each Zod schema's field-level detail) and additionally stamps each operation with its actual required role, read from the same `@Roles`/`@Public` metadata `RolesGuard` enforces at request time (`annotateRequiredAccess`), so a route's documented access requirement can't drift from what the guard actually does the way a hand-written note beside it could. `pnpm --filter api run openapi:export` (`apps/api/src/openapi/export.ts`) writes that exact document to `docs/openapi.yaml`; the live, always-current version is also served directly at `GET /api/v1/docs-json` (and a browsable UI at `/api/v1/docs`), so the committed file is a reviewable snapshot, never the only copy.
