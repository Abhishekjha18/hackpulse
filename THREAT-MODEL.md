# HackPulse: Threat Model

Named attacks against a hackathon platform, what actually stops each one in this codebase (with file references), and, per the brief's own instruction, an honest list of what does not. Overclaiming here would be worse than the gap itself.

## 1. Sybil / duplicate voting

**Attack**: one person casts many votes for one project by registering multiple accounts or exploiting the anonymous-voting path.

**Mitigated**:

- Authenticated voting: one vote row per `(event, submission, voter)`, enforced by a unique constraint (`votes` table), not just application logic, so even a raced double-submit can't create two rows (`onConflictDoUpdate` replaces, never duplicates).
- Anonymous voting (`open_link`): the client supplies an `X-Voter-Token`; the same unique constraint applies keyed on that token (`voting.service.ts`). This stops naive repeat-voting from the same browser session.
- `email_gated`: the voter supplies an email address (`X-Voter-Email`) instead of a token, and the same unique constraint keys on it (normalized to lowercase), which raises the bar from "clear browser storage" to "type a different email each time." This is **not** verified-mailbox voting: there is no outbound email in this project (`NFR-OPS-01`), so nothing confirms the voter actually controls the address they typed. It is a self-reported identity, one notch stronger than `open_link` and no more.
- Rate limiting: 20 votes/minute per voter identity (`RateLimiterService`, `voting.service.ts`), which bounds how fast even a determined script can hammer the endpoint.
- Eligibility (`vote-eligibility.util.ts`, found by a live test where a team owner voted for their own project and a judge voted): an account-backed voter who is on the submission's team, or who is a judge/organizer of the event, is refused with 403; voting on a draft, published or archived event is refused with 409. Anonymous token/email voters carry no identity, so these checks cannot apply to them.
- Event-wide anonymous velocity cap: at most 120 anonymous votes per minute per event (`ANON_EVENT_VOTES_PER_MINUTE`). It does not stop token rotation, it bounds how quickly it can move the tally. A per-IP limit was deliberately not added: browser traffic reaches the API through the web proxy, so every voter shares the proxy's address and the API has no trusted forwarded-for, meaning a per-IP limit would either do nothing or throttle everyone together.
- Quadratic mode structurally reduces the payoff of Sybil accounts for concentrating influence on one project: each identity's budget is fixed and the marginal cost of votes on one target rises with the square, so splitting into two honest identities gets you _less_ combined influence on one target than one identity with double the budget would, not more.

**Not mitigated (named honestly)**:

- Nothing stops a person from registering 10 real accounts (Better Auth requires only an email, no verification is wired up) and voting once from each. This is the fundamental Sybil problem, and it is not solved by anything short of identity verification, which is out of scope for a self-hosted, no-external-service system by design (NFR-OPS-01). The brief's own recommended mitigation for exactly this reason (keep the prize small, hide results until reviewed) is the honest answer here, and `FR-RESULT-01/02` (results hidden until organizer publish) is what actually implements that operational mitigation.
- The anonymous voter token is entirely client-supplied and unverified: a script can generate a fresh token per request and bypass the per-voter unique constraint and rate limit entirely by rotating identities. This is a real, named gap. `open_link` voting access is a deliberate trust tradeoff the organizer opts into; `authenticated` mode does not have this specific hole (Better Auth's session cookie is not client-forgeable).

## 2. Ballot stuffing via automation

**Attack**: a script drives the voting endpoint directly (bypassing the UI) to cast many votes quickly.

**Mitigated**: the rate limiter (`RateLimiterService`) applies at the API layer regardless of client: there is no UI-only gate to route around, matching the project-wide rule that authorization/abuse controls live in the backend (`ARCHITECTURE.md` §6). IP is hashed and stored per vote (`votes.ipHash`) so an organizer reviewing results can spot a cluster of votes from one address without the system ever storing raw IPs.

**Not mitigated**: the rate limit is per-identity, not per-IP: a script rotating both IP and voter token defeats both defenses simultaneously. A proper fix (IP-based secondary limiting, or a proof-of-work/CAPTCHA challenge) is out of scope for this build; documented here rather than silently absent.

## 3. Submission scraping

**Attack**: a competitor or bad actor scrapes the public gallery to steal ideas, or scrapes at scale to build a shadow copy of the event.

**Mitigated**: the gallery respects `galleryVisibility` (`open` / `participants_only` / `hidden`) at both the listing endpoint and the individual-submission endpoint (`gallery.service.ts`, `submissions.service.ts`, the latter checking visibility even when a caller has the raw UUID, so an unguessable ID is never treated as an access control on its own). An organizer who doesn't want public scraping simply sets `hidden` or `participants_only`.

**Not mitigated**: `open` galleries are, by definition and by design, meant to be publicly readable: that is the whole point of a public gallery and of the embeddable widget (`FR-WIDGET-01`). There is no rate limiting on gallery reads, so a determined scraper can pull the entire public gallery quickly. This is treated as acceptable because the content is _intentionally_ public in that mode; if an organizer disagrees, `participants_only` or `hidden` is the actual answer, not a rate limit on public data.

## 4. Judge collusion / low-effort judging

**Attack**: two judges agree in advance on scores, or a judge scores everything the same value without engaging (the exact "everyone's a 3" scenario the brief names).

**Mitigated**:

- Z-score normalization (`normalization.service.ts`) makes a judge with zero variance in their scores (σ=0) normalize to exactly 0 for every submission they scored: such a judge stops moving anyone's rank rather than being silently averaged in at face value, which is the direct, documented answer to "the judge who marks everything a 3" (see `JUDGING.md`).
- Backend-enforced role isolation (`AssignmentOwnershipGuard`) means a judge cannot read another judge's scores at all, closing the most direct channel for two judges to coordinate their numbers against what they see on the platform itself (they'd have to collude entirely out-of-band, which no software control can stop).
- The append-only, hash-chained audit log (`audit.service.ts`) records every score submission and revision with a timestamp and actor: an organizer investigating suspected collusion (e.g., near-identical score patterns filed within seconds of each other) has a tamper-evident record to work from.

**Not mitigated**: there is no automated collusion _detection_ (e.g., statistical similarity flagging between two judges' score vectors), only the normalization defense against the _effect_ of one degenerate judge, and an audit trail for _investigating after the fact_. Real-time collusion-pattern detection is a reasonable T5 feature, not built here.

## 5. Deadline gaming

**Attack**: submitting or editing after the deadline by manipulating the client's clock, retry timing, or racing the exact cutoff second.

**Mitigated**: every deadline check (`submissions.service.ts` `update`/`submit`) compares against `new Date()` evaluated on the server at request-handling time against the `submissionCloseAt` column read fresh from Postgres: the client's reported time is never consulted anywhere in the codebase. `FR-EVT-03`'s constraint (`events.service.ts`) additionally prevents an organizer from _retroactively_ shortening a deadline past a submission that already exists in good faith, which is a different but related deadline-integrity property (protecting participants from the organizer's own mistakes, not just the reverse).

**Not mitigated**: request latency means a submission that starts just before the deadline and completes just after is handled by "the deadline as of when the database write happens," not "the deadline as of when the user clicked submit": a few hundred milliseconds of edge-case unfairness at the exact cutoff second is possible and not specially handled. This is judged an acceptable tradeoff versus the complexity of request-start timestamping.

## 6. Session and account attacks

**Attack**: session hijacking, credential stuffing, CSRF.

**Mitigated**: sessions are opaque, httpOnly, SameSite=Lax cookies managed by Better Auth (`auth.config.ts`): never readable by client-side JS, never a JWT with forgeable claims. Better Auth's own rate limiting is configured on the auth endpoints (`rateLimit` in `auth.config.ts`) to slow credential-stuffing attempts. `trustedOrigins` is explicitly configured (not left to a permissive default) so a request claiming to originate from an untrusted page is rejected outright: this is what actually stops a basic CSRF attempt from a third-party page, since the forged request won't carry a trusted `Origin`.

**Not mitigated**: there is no 2FA, no email verification, no anomaly-based login alerting (new device/location). These are reasonable real-product features not built for this scope. Password reset (`FR-AUTH-06`) is specified but not implemented: a genuine, named gap, not a silent one.

## 7. Webhook and certificate forgery

**Attack**: a third party pretends a webhook came from HackPulse, or forges a certificate/judge-participation claim.

**Mitigated**: every webhook payload is HMAC-SHA256-signed with a secret unique to that webhook registration (`webhook.processor.ts`): a receiver that verifies the signature can reject anything not actually sent by this instance. Judge participation records are Ed25519-signed with a persistent instance keypair (`signing-key.service.ts`) and independently, publicly verifiable (`GET /verify/judge-record/:id`) without trusting the server's say-so at read time (verified live against real tampering: flipping a byte of the stored payload makes verification fail).

**Not mitigated**: the webhook secret and the Ed25519 private key both live in this instance's Postgres database: a full database compromise exposes both, which is the same trust boundary as everything else in a self-hosted, single-database system. There is no hardware security module or external KMS (out of scope per NFR-OPS-01/NFR-PORT-02, no external service dependency).

## 8. Audit log tampering

**Attack**: an organizer, admin, or attacker with database access rewrites history to hide misconduct (a manipulated score, a backdated action).

**Mitigated**: two independent layers, verified live, not just claimed:

1. **Grant-level**: the runtime database role (`hackpulse_app`) has `UPDATE`/`DELETE` explicitly revoked on `audit_log_entries` (`0001_restrict_audit_log_grants.sql`): the _application_, even if fully compromised, cannot rewrite or erase an entry through any code path, because Postgres itself refuses the statement.
2. **Cryptographic**: each entry embeds the hash of the previous entry in its partition (`audit.service.ts`); `GET .../audit-log/verify` recomputes the whole chain and flags exactly which entry breaks and how. Verified live against a real `UPDATE ... SET metadata = ...` issued directly via `psql` as the _owning_ role (which does still have UPDATE): the chain check caught it immediately.

**Not mitigated**: the owning database role (`hackpulse`, used only for migrations) is not grant-restricted the same way, because it needs full DDL rights to alter schema over time: anyone with that role's credentials (i.e., whoever operates the instance) can still tamper with rows directly in Postgres, and the hash chain will _detect_ that but cannot _prevent_ it. Preventing it fully would require a write-once external log (e.g., a separate append-only service or a public transparency log), a legitimate T5 idea, not built here. Detection with a stated blast radius is the honest claim, not prevention.

## 9. SQL injection / input validation

**Attack**: malicious input in any request body reaching the database unsanitized.

**Mitigated**: every mutating endpoint validates its body against a Zod schema (`ZodValidationPipe`) before it reaches a service; all database access goes through Drizzle's parameterized query builder: there is no raw string-concatenated SQL anywhere in the codebase except the two `pg_advisory_xact_lock(...)` calls (`audit.service.ts`, `signing-key.service.ts`), both of which take a numeric lock key computed in-process (an FNV-1a hash or a fixed constant), never user input.

**Not mitigated**: nothing specific: this is a closed, structural mitigation (validation + parameterization everywhere) rather than a partial one, and it hasn't been fuzz-tested, which would be the honest next step before calling it exhaustively verified.

## 10. Cross-site scripting via user-supplied URLs

**Attack**: a `javascript:` URL stored in a field the app later renders as a clickable link (a submission's `repoUrl`/`liveUrl`/`demoVideoUrl`/`thumbnailUrl`, an event's `bannerImageUrl`, a profile's `githubUrl`/`linkedinUrl`/`websiteUrl`) executes when another user clicks it.

**Mitigated**: found live while checking the banner and gallery widget were fully functional, not while looking for this specifically: every one of these fields only ever validated with plain `z.string().url()`, which accepts any scheme, including `javascript:`. A shared `httpUrl()` helper (`packages/shared/src/common.ts`) now rejects anything but `http`/`https` at the schema layer, the same place every other field-level validation already lives, so every field above is closed by one fix rather than seven separate ones. The embeddable gallery widget (`widget-renderer.ts`) hand-builds raw HTML from submission data for an external page's `<iframe>`, the highest-risk render path here since it isn't React's own JSX (which HTML-escapes text content by default, though not `href`/`src` attribute values): it gets a second, render-time scheme check as defense in depth, so a row that predates the schema fix still can't produce a clickable `javascript:` link there.

**Not mitigated**: general HTML/script injection through free-text fields (a submission's `description`, a comment body) is not separately fuzz-tested; React's default text-node escaping is the structural mitigation there (every one of these is rendered as text content, never `dangerouslySetInnerHTML`), not a input-sanitization pass, and that boundary hasn't been independently verified beyond code review.
