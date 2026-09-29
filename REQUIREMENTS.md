# HackPulse: Requirements Specification

HackPulse is a self-hosted submission-and-judging portal for hackathons: registration through certificates, in one product. This document is the authoritative requirement set the design (`ARCHITECTURE.md`), data model (`DATA-MODEL.md`), and API contract (`API-DESIGN.md` / `docs/openapi.yaml`) are all derived from. Every requirement has a stable ID so later documents, code, and tests can reference it directly instead of re-describing it.

## 1. Purpose & Scope

Build one product (not a gallery and a separate judging tool) that takes a hackathon through its full lifecycle:

registration → teams → submissions → eligibility → judge assignment → scoring → normalization → results → certificates → archive.

The system must run entirely on a single machine with no external cloud dependency (database, auth provider, or otherwise), started with one command.

## 2. Actors

| Actor           | Definition                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Visitor**     | Unauthenticated user. Can view public event pages and the public gallery (if the organizer allows it).                     |
| **Participant** | Authenticated user who has joined a team and/or made a submission.                                                         |
| **Judge**       | Authenticated user assigned to score submissions, scoped to one or more tracks.                                            |
| **Organizer**   | Authenticated user who administers one or more events: configuration, judge assignment, rubric design, publishing results. |
| **Admin**       | Superuser across all events on the instance: user management, instance configuration, full audit access.                   |

A single user account may hold different roles on different events (e.g., organizer of Event A, judge on Event B): role is **scoped to an event**, not global, except `admin`.

## 3. Functional Requirements

### 3.1 Authentication & Session (FR-AUTH)

- **FR-AUTH-01**: Users register with email + password. Passwords are hashed with a memory-hard algorithm; plaintext is never persisted or logged. (Found live: this named argon2id specifically, but the actual algorithm, read from Better Auth's own installed source `dist/crypto/password.mjs`, is `node:crypto scrypt`, also memory-hard and also the right kind of algorithm for this job, just not the one named here. See ARCHITECTURE.md §5.1.)
- **FR-AUTH-02**: Sessions are server-side, opaque tokens stored in an httpOnly, secure, sameSite cookie. No sensitive claims are stored client-side.
- **FR-AUTH-03**: Sessions are revocable server-side (logout, "log out everywhere", admin-forced revocation) and expire after a configurable idle timeout.
- **FR-AUTH-04**: All mutating requests are protected against CSRF (double-submit token or equivalent).
- **FR-AUTH-05**: Failed login attempts are rate-limited per account and per IP.
- **FR-AUTH-06**: Password reset via a single-use, time-limited token. No third-party email delivery is required to operate offline; reset links may also be surfaced organizer-side for local/offline use.

### 3.2 Roles & Authorization (FR-ROLE)

- **FR-ROLE-01**: Every API route declares the minimum role(s) permitted to call it; unauthorized calls return `403`, unauthenticated calls return `401`. This check happens in the backend request pipeline, never only in UI rendering.
- **FR-ROLE-02**: A judge can only read/write their own scores. Attempting to read another judge's scores for the same submission returns `403`, not a filtered/empty result (which would leak existence).
- **FR-ROLE-03**: A judge scoped to track A cannot read submissions, assignments, or scores belonging to track B.
- **FR-ROLE-04**: Organizers and admins can read everything within their event(s); admins can read across all events.
- **FR-ROLE-05**: Role-isolation rules must be enforced identically regardless of client: verifiable by direct HTTP calls (`curl`), not just through the shipped UI. A judge, participant, or visitor hitting another actor's resource (peer scores, another track, the audit log) gets `403`/`401` from the backend itself, never a response that merely looks filtered by the frontend.
- **FR-ROLE-06**: Every authorization decision (permit or deny) on a sensitive resource (scores, PII, audit log) is attributable to an actor and is auditable (see FR-ABUSE-05).

### 3.3 Event Management (FR-EVT)

- **FR-EVT-01**: An organizer can create an event with: name, description, timezone, registration open/close, submission open/close (deadline), judging window, results-publish time, one or more tracks, one or more prizes. Each prize is optionally scoped to one track (event-wide otherwise) and has a `winnerCount`: how many ranked entries within that scope actually win it, e.g. "top 3 in AI/ML" or "top 3 overall" for a single-track event, defaulting to 1. Requested explicitly, after finding the system silently assumed exactly one winner per prize with no way to configure more; editable after creation via `PATCH`, not just at creation time. See FR-RESULT-06 for how a prize's `winnerCount` determines who actually wins it. `winnerCount` is shown on the public event page's prize list, not only the organizer dashboard's edit form. Found live: participants had no way to know whether a prize had one winner or several ahead of results being published. `bannerImageUrl` (optional, organizer-editable via `PATCH` at any time, blank falls back to a generated default banner) is rendered at the top of the event page and on its card in the events list and homepage. Every user-supplied URL field across the app (`bannerImageUrl` here, a submission's `thumbnailUrl`/`galleryImageUrls`/`demoVideoUrl`/`repoUrl`/`liveUrl`, a profile's `githubUrl`/`linkedinUrl`/`websiteUrl`) is validated with the shared `httpUrl()` helper (`packages/shared/src/common.ts`), rejecting any scheme but `http`/`https`. Found live while checking the banner and gallery widget were "fully functional": plain `z.string().url()` accepts any scheme, including `javascript:`, which several of these fields render as a clickable link (the gallery widget's hand-built HTML, and the main app's own JSX; neither sanitizes `href`, since React doesn't do this automatically). A `javascript:` URL stored in one of these fields would have executed on click.
- **FR-EVT-02**: In automatic-mode events (FR-EVT-06), deadlines are stored in UTC and enforced server-side; a request arriving after a deadline is rejected regardless of client-reported time. The submission window has a start as well as an end: creating, editing, or submitting a project outside `submissionOpenAt`/`submissionCloseAt` gets `409 SUBMISSIONS_NOT_OPEN` / `DEADLINE_PASSED`. The judging window (`judgingOpenAt`/`judgingCloseAt`) is enforced too: a judge attempting to save/submit a score, or record a pairwise comparison, outside it gets `409 JUDGING_NOT_OPEN` / `JUDGING_WINDOW_CLOSED`, and `judgingOpenAt` can never be set (on create or update) earlier than `submissionCloseAt`, so judging can't be configured to start before submissions are actually done. In manual-mode events, the same rejections happen but are gated by `status` instead of a clock, see FR-EVT-06.
- **FR-EVT-03**: An organizer can edit event configuration before and, for non-structural fields, during the event; structural changes (e.g., shortening a deadline that has passed) are constrained to prevent retroactively invalidating existing submissions.
- **FR-EVT-04**: An event can define custom submission questions (text, long text, single-select, multi-select, URL, number) that apply per-track or globally.
- **FR-EVT-05**: An event has an explicit lifecycle status (`draft → registration_open → submissions_open → judging → results_published → archived`) shown throughout the UI as a label for where the event stands. `draft` hides the event from the public list; `results_published` reveals results to non-organizers. Beyond that, how status behaves depends on the event's lifecycle mode (FR-EVT-06), see that entry for the full picture. In both modes, every `Event` response carries a `displayStatus` field alongside the stored `status`: in automatic mode it's computed fresh from the window timestamps (so it can never sit stale the way a manually-picked label could); in manual mode it's simply equal to `status`, since there's no clock to compute it from. The UI renders `displayStatus`, not `status`, everywhere it shows this badge, including the organizer dashboard's own status control.
- **FR-EVT-06**: Every event picks one of two lifecycle modes at creation, permanently. Requested explicitly, after finding that layering status-based gating on top of timestamp gating (or vice versa) creates real edge cases (an organizer moving status to `judging` a little early could lock out participants who, by the declared deadline, should still have time to submit).
  - **Automatic mode**: all six lifecycle timestamps (`registrationOpenAt`/`CloseAt`, `submissionOpenAt`/`CloseAt`, `judgingOpenAt`/`CloseAt`) are set at creation, `registrationOpenAt` must be in the future, and the full chain `registrationOpenAt < registrationCloseAt <= submissionOpenAt < submissionCloseAt <= judgingOpenAt < judgingCloseAt` is enforced end to end, not just adjacent pairs (found live: `submissionOpenAt` could be set before `registrationCloseAt`, even before `registrationOpenAt`, with nothing rejecting it). The stored `status` column starts at `draft` and can only ever be changed once more directly, to `archived`, and only once results are published, but **visibility no longer requires an organizer click** (requested explicitly, "remove the make public button... it goes live on its own"): an automatic-mode event becomes visible (events list, homepage, `findOne`, search, gallery, widget) the moment `registrationOpenAt` actually passes, the stored `status` staying literally `draft` the whole time. `isEventVisible`/`isVisibleCondition` (`events.service.ts`, exported for reuse in `gallery.service.ts`/`search.service.ts`) is the one shared definition of "is this event actually public," used everywhere `status !== "draft"` used to be checked directly. Everything in between, registration, submissions, judging, is gated purely by the timestamps and reflected live via `displayStatus`; the organizer never sets those three values directly. Once a given timestamp has itself already passed, it's locked (`409 LIFECYCLE_DATE_LOCKED`), an organizer can't retroactively rewrite when a phase actually started or ended after people already relied on it. Only timestamps still in the future stay editable (e.g. mid-registration, only `registrationCloseAt` onward can move; mid-submissions, only `submissionCloseAt` onward), same ordering rules as creation. Found live: every date was freely editable at any time regardless of whether that phase had already begun. The organizer dashboard mirrors both rules client-side (a passed field is disabled; each field's `min` is the previous field's current value) so an invalid date can't be entered in the first place, not just rejected after the fact, the backend re-checks the same chain regardless, since the client-side steer is never the real guarantee.
  - **Manual mode**: all six timestamps are omitted (always `null`) and `status` is the organizer's direct, honest control, moved by hand through the same six values. **Forward moves must land on the immediate next status in the sequence** (`draft → registration_open → submissions_open → judging`). Requested explicitly ("blocked from moving to any other status directly, from the UI as well as the backend"): skipping ahead (e.g. `draft` straight to `judging`) is rejected (`409 STATUS_MUST_BE_SEQUENTIAL`), enforced both in `assertValidStatusTransition` and by the organizer dashboard's status dropdown only ever offering current status + 1. `results_published`/`archived` sit outside this sequence (their own dedicated rules below) and are unaffected. Moving status **backward** is unaffected by this change and stays exactly as before: blocked once it would misrepresent real data already in the system (back to `draft`/`registration_open` rejected once any submission exists, `409 SUBMISSIONS_EXIST`; back past `submissions_open` rejected once judging has produced a completed score or pairwise comparison, `409 JUDGING_STARTED`), allowed otherwise. Registration, submissions, and judging actions are gated by `status` being exactly the matching value, the manual equivalent of the automatic-mode timestamp windows.
  - **Both modes**: `results_published` can never be set directly (`409 USE_PUBLISH_ENDPOINT`), only `POST .../results/publish` sets it, and only once every submission is judged (FR-RESULT-04) and, in automatic mode, `judgingCloseAt` has passed (in manual mode, `status` must already be `judging`). `archived` requires `status` to already be `results_published`, and once archived, status is permanently locked (`409 EVENT_ARCHIVED`). A DB check constraint enforces that the six timestamps are all set or all null, never a mix, as the ground truth beneath everything above.
  - **Events list `phase` filter (`GET /events?phase=active|past`), used by both the homepage and the events list page**: `past` means exactly `status = 'archived'`, `active` means everything else, identically in both lifecycle modes. Requested explicitly: an event only belongs in "past" once an organizer has actually archived it, never as a side effect of the clock or of `status` merely reaching `judging`/`results_published` on its own. This is the settled version of two bugs found in sequence. First (live): a manual-mode event's `submissionCloseAt` is always `null`, and the original filter compared `submissionCloseAt + 24h` against `now()` for every event, `NULL + interval > now()` evaluates to `NULL` in SQL, which a `WHERE` clause silently treats as excluding the row, so every manual-mode event was invisible in both tabs regardless of status. That was first fixed by branching on lifecycle mode (timestamp check for automatic, a `status IN (...)` list for manual), but that still classified `judging`/`results_published` as "past" with no organizer action at all, which wasn't wanted. The filter is now unconditional on lifecycle mode entirely: `archived` is reachable in both modes only via an explicit, one-directional organizer action (`assertValidStatusTransition` requires `results_published` first), so it alone is the honest "past" signal for either mode.

### 3.4 Team Formation (FR-TEAM)

- **FR-TEAM-01**: A participant can create a team for an event and receives a shareable invite link/code.
- **FR-TEAM-02**: A participant can join a team via invite link, subject to the event's max team size.
- **FR-TEAM-03**: A team has exactly one submission per track it enters.
- **FR-TEAM-04**: A team member can leave a team before the submission deadline; the team owner can remove members.
- **FR-TEAM-05**: Organizing/judging and participating in the same event are mutually exclusive, structurally rather than by convention: an organizer or a judge who's accepted their invite can't create or join a team on that event (`409 CONFLICT`), and the reverse holds too, a participant already on a team for an event can't accept a judge or co-organizer invite for it. Enforced at every event status, not just while registration is nominally open. The event's team-registration page mirrors this (a blocking message in place of the create/join forms for anyone who organizes or judges the event) rather than only rejecting the request after the fact. Found live: accepting an invite granted the role immediately server-side, but the client's cached role list didn't refresh until some unrelated later reload, so the registration page's own check (and this rule generally) could read stale state right after acceptance.
- **FR-TEAM-05**: Invite links are single-event-scoped and can be regenerated (invalidating the old one) by the team owner.

### 3.5 Submission Management (FR-SUB)

- **FR-SUB-01**: A team can create and edit a draft submission with: name, tagline, long description, thumbnail image, image gallery, demo video URL, repository URL, live/demo link, tech tags, track, plus organizer-defined custom question answers.
- **FR-SUB-02**: A submission can be saved as a draft repeatedly; only submitting (explicit action) locks the version in for judging as of the deadline.
- **FR-SUB-03**: After the submission deadline, edits are rejected server-side; the enforcement is on the server clock, not the client's.
- **FR-SUB-04**: Submission history (draft edits) is retained for audit purposes even though only the final version is judged.
- **FR-SUB-05**: A submission belongs to exactly one track within its event.

### 3.6 Public Gallery (FR-GAL)

- **FR-GAL-01**: Visitors can browse a public gallery of submitted (not draft) projects once the organizer publishes the gallery.
- **FR-GAL-02**: The gallery supports search (name/tagline/description/tags) and filtering (track, tag).
- **FR-GAL-03**: Gallery visibility is organizer-controlled per event (open, participants-only, or hidden).

### 3.7 Judge Assignment (FR-JASSIGN)

- **FR-JASSIGN-01**: An organizer can invite users as judges for an event and scope each judge to one or more tracks, including inviting themselves (self-judging), which holds both `organizer` and `judge` roles on the event simultaneously. The event page shows both the organizer dashboard and judging queue links to such a user. Found live, this silently showed only one (whichever role happened to come back first from the roles list), not both.
- **FR-JASSIGN-02**: An organizer can assign submissions to judges manually (by batch) or algorithmically (load-balanced, minimum N judges per submission, conflict-of-interest exclusion by declared affiliation). "Even distribution" means genuinely load-balanced, not blind rotation: each eligible judge's _current_ assignment count across the whole event (not just the track being assigned) is queried up front and kept updated as the run proceeds, so the least-loaded eligible judge is always picked first; ties are broken by fewest total track scopes on the event (a judge with fewer other chances goes first), then by query order. Found live: a plain per-track rotating offset reset to 0 on every call, so a judge scoped to one track and a judge scoped to three could end up with 0 and 3 assignments respectively even though both were eligible for the one track that mattered. Assignment itself is blocked until the judging phase has actually started (`409 JUDGING_NOT_STARTED`), `judgingOpenAt` has passed in automatic mode, `status` is `judging` in manual mode (FR-EVT-06), not merely `submissionCloseAt` (requested explicitly: an organizer shouldn't be able to assign the moment submissions close if judgingOpenAt is deliberately later still). The algorithmic strategy also doesn't "top up" an existing assignment (it always adds N more), so running it before every submission is in risks over-assigning the ones already covered once it runs again for late arrivals.
- **FR-JASSIGN-03**: A judge sees only the submissions assigned to them.
- **FR-JASSIGN-04**: Reassignment (adding/removing a judge from a submission) is possible before that judge has submitted a score for it; already-submitted scores are preserved with an audit trail if reassignment happens after.

### 3.8 Rubric & Scoring (FR-SCORE)

- **FR-SCORE-01**: An organizer defines a rubric per event (or per track) as a set of weighted criteria; weights need not be equal and must sum to a normalized 100%.
- **FR-SCORE-02**: A judge scores an assigned submission on each rubric criterion using a 1–5 scale (configurable range), with optional free-text feedback per criterion and overall.
- **FR-SCORE-03**: A judge's per-submission weighted score = Σ(criterion score × criterion weight); this raw score is stored alongside the normalized score, never overwritten.
- **FR-SCORE-04**: Scores can be saved as drafts and submitted explicitly; only submitted scores count toward results.
- **FR-SCORE-05**: Once a judge submits a score for a submission, edits are logged as revisions (audit trail), not silently overwritten.

### 3.9 Cross-Judge Normalization (FR-NORM)

- **FR-NORM-01**: The system computes a per-judge z-score normalization of raw scores to correct for judges who score systematically high, low, or with low variance ("everything's a 3").
- **FR-NORM-02**: The normalization method is documented, deterministic, and reproducible from raw data (see `JUDGING.md`, produced in a later phase).
- **FR-NORM-03**: Both raw and normalized scores are retained and independently exportable.
- **FR-NORM-04**: The organizer dashboard flags judges whose score distribution is a statistical outlier (near-zero variance, or systematically divergent from peer consensus on the same submissions) for organizer review; it does not silently discard their scores.

### 3.10 Pairwise Judging Mode (FR-PAIR, alternative to FR-SCORE)

- **FR-PAIR-01**: As an alternative scoring mode selectable per event (event-wide, never mixed per track, a track's rubric is picked by the event's `scoringMode`, not chosen independently), judges are shown two submissions at a time and asked which is better (ties allowed). The judge-facing comparison UI (`PairwiseJudging`, wired into the judge page) was built from the start; found live that the organizer-facing toggle to actually turn it on wasn't, `scoringMode` was only ever settable via a direct API call, with no control in the create-event form or the organizer dashboard. Now a "Scoring mode" select in the organizer dashboard's Event settings (same freely-switchable-any-time posture as gallery visibility/voting mode right next to it, no backend lock exists on changing it, so the UI doesn't invent one either). Each comparison card shows name, tagline, and tech tags for a quick scan, plus an "Open full submission ↗" link to the existing submission detail page (`/submissions/:id`, the same page the public gallery uses) in a new tab. Found live that this card only ever showed name and tagline with no way to actually review either project before picking one (the exact gap rubric-mode judging had already fixed once, just never mirrored into this component when it was built). The first fix inlined the full description, tags, and repo/live/video links directly onto the card, but that made a narrow, half-width card look cramped ("congested", description and links stacked so tight they read as one dense block, and a submission missing one or two of the three link types just left the card looking lopsided); linking out to the dedicated detail page (which already shows all of it cleanly, full-width) was the better fix, and it's also the more literal answer to a separate live report, "cannot open the submission", than any amount of on-card tweaking would have been. That detail page itself was found to be missing its own `demoVideoUrl` link (an oversight there specifically, unrelated to the pairwise card work, just surfaced by it), fixed to match the rubric judging page's three-link set. Both comparison cards sit in a `grid`+`flex flex-col` layout with the pick button pinned to the bottom (`mt-auto`) rather than immediately after the tagline, so two submissions with very different amounts of content don't leave their buttons at visibly different heights. Found live in a follow-up pass ("alignment of the view full submission button is very congested... if one project has a bigger description and one has smaller, the button is not aligned properly"): `mt-auto` was only ever on the pick button itself, so the "Open full submission" link right above it still sat wherever the variable-length tagline/tags happened to end, misaligned between two cards whenever one had more to show than the other, even though the button below it was already correctly aligned. Fixed by grouping the link and the button into one shared `mt-auto` block, so the whole cluster moves together to the bottom of the (grid-stretched) card, with the link always sitting a fixed distance above the button either way.
- **FR-PAIR-01a (pending-judging notification and organizer progress)**: A judge on a pairwise-mode event gets the same "you have pending judging work" notification a rubric-mode judge gets, and an organizer sees the same kind of per-judge "Judging progress" table a rubric-mode event's dashboard shows. Found live, in two related reports: first "did not receive any notification on judging the submission", the notifications bell's pending-judging check only ever queried the rubric-mode assignment queue (`judgeAssignments`), which pairwise mode never populates, so a pairwise judge got this reminder never, regardless of real pending work; then, separately, "nothing is shown on judging progress and per-submission coverage either", the organizer dashboard's own "Judging progress" section has the identical root cause, reading the same empty table. `PairwiseService.getProgressForJudge` / `GET .../pairwise/progress` (judge-only, self-scoped, mirrors `AssignmentsController`'s `queue` for rubric mode) and `getProgressForOrganizer` / `GET .../pairwise/organizer-progress` (organizer-only, every judge on every track, mirrors `AssignmentsController`'s `progress`) are the fix, both built on the same per-(judge, track) pair count: how many of a track's total possible pairs (`n·(n−1)/2` for `n` submitted submissions) this judge has compared, tying cleanly to `getNextPair`'s own `ALL_PAIRS_COMPARED` cutoff (FR-PAIR-03), 0 remaining for a track means `next()` will no longer offer one. The organizer view is one row per (judge, track), not one row per judge the way rubric mode's table is, since a judge's coverage here is inherently track-scoped (collapsing two tracks into one total would hide which specific track still needs attention). There's no pairwise analog to rubric mode's "per-submission coverage" table to build alongside it, a submission's coverage there isn't a single number, it's how many of its pairs each individual judge has compared, which the judge×track table already shows from the judge's side, so the organizer dashboard says that explicitly instead of showing an empty or misleading table.
- **FR-PAIR-02**: A global ranking is recovered from pairwise comparisons via a Bradley-Terry maximum-likelihood estimator.
- **FR-PAIR-03**: Comparison pairs are selected to maximize information gain (e.g., preferring submissions with fewer existing comparisons) rather than pure random sampling, within the pool a judge is authorized to see. Once a judge has compared every possible pair in a track exactly once, `GET .../pairwise/next` returns `409 ALL_PAIRS_COMPARED`, a track is finite for a given judge, not an endlessly re-servable stream. Found live ("the judge is stuck in a loop... these comparisons keep repeating, neither does the notification go away"): this used to fall back to re-serving a pair once every pair had been seen once (the original design assumed continuous refinement was always wanted, "Gavel"-style), but since the "least-compared" selection tiebreak recomputes fresh counts on every call, voting on an already-compared pair again shifted which pair now looked "least compared" next, so instead of settling on one static repeat it quietly rotated through every pair in the track forever. Indistinguishable from a genuine infinite loop to a judge who'd actually finished, and it silently recorded a fresh duplicate row on every one of those repeat votes, skewing the Bradley-Terry input with noise that was never real judgment. `compare()` itself also now rejects a repeat of an already-recorded pair (`409 ALREADY_COMPARED`), defense in depth alongside `next()` never offering one.
- **FR-PAIR-04**: Ranking uncertainty is exposed (e.g., bootstrap confidence interval), not just a bare ordering.

### 3.11 Organizer Dashboard (FR-DASH)

- **FR-DASH-01**: An organizer can see judging progress in near-real-time: per-judge completion, per-submission coverage, and which judges have not started.
- **FR-DASH-02**: An organizer can see live counts (registrations, teams, submissions) without needing a database client.
- **FR-DASH-03**: An organizer can preview computed results before publishing them.

### 3.12 Data Export (FR-EXP)

- **FR-EXP-01**: CSV export is available at every stage: registrations, teams, submissions, judge assignments, raw scores, normalized scores, final rankings, votes, audit log. JSON export is also available for the same resources (`GET .../export/<resource>.json` alongside `.csv`), added on request as an equivalent alternative, the exact same rows either way, just a different encoding, useful for anything consuming the export programmatically rather than opening it in a spreadsheet.
- **FR-EXP-02**: Exports respect the requester's role: an export never contains data the requester could not otherwise see via the API.

### 3.13 Community Voting (FR-VOTE)

- **FR-VOTE-01**: An organizer can enable community voting per event with a configurable access mode: open link, email-gated, or authenticated-participant-only.
- **FR-VOTE-02**: Default voting is one-vote-per-voter-per-submission; quadratic voting (cost of _n_ votes on one project = √n of a fixed voice budget, `QUADRATIC_BUDGET = 10`) is available as a configurable alternative. Verified live: this makes casting a moderate number of votes on more than one submission cheap, e.g. 9 votes on one project plus 4 on another costs √9 + √4 = 5 of the 10-credit budget, well under the limit, so no rejection is expected there. The 409 only fires once the running total would exceed 10 (e.g. a 3rd vote of 64 on top of that would cost 8 more, totaling 13). This is spec-correct behavior, not a bug, confirmed by casting votes that do cross the budget and getting the expected `409 CONFLICT` naming the remaining balance.
- **FR-VOTE-03**: Ballots present submissions in randomized order per voter session to prevent position bias.
- **FR-VOTE-04**: Voting is rate-limited and duplicate-vote detection applies (see FR-ABUSE).

### 3.14 Comments (FR-COMMENT)

- **FR-COMMENT-01**: Authenticated users (scope configurable: participants only, or anyone with voting access) can comment on gallery projects.
- **FR-COMMENT-02**: Organizers/admins can moderate (hide/delete) comments; deletion is soft (audit-preserving) not physical.

### 3.15 Results Visibility (FR-RESULT)

- **FR-RESULT-01**: Judge scores, normalized scores, and rankings are visible only to organizers/admins until the organizer explicitly publishes results.
- **FR-RESULT-02**: Community vote tallies are hidden from all non-organizer roles during the voting window, regardless of authentication. Organizers themselves can always see the tally, pre- or post-publish. Reported live as "I don't know from where to view and verify the vote tally as an organizer": the backend already allowed it, but the only surface was a "View results" link off to a separate page, buried below rubric/pairwise sections. Now also shown inline in the organizer dashboard's Results tab (auto-refreshing every 30s, same as judging progress), so it doesn't require leaving the dashboard.
- **FR-RESULT-03**: Once published, results visibility (public / participants-only) is organizer-configurable per event.
- **FR-RESULT-04**: Publishing is blocked while any submitted project has zero judging input (no completed score, no pairwise comparison), and separately while judging isn't actually over yet (`409 JUDGING_STILL_OPEN`) even if everything already happens to be judged, since "everyone's scored" and "judging is actually done" are different facts, `judgingCloseAt` hasn't passed in automatic-mode events, `status` isn't `judging` in manual-mode ones (FR-EVT-06). Added live, after a user asked "how do we make sure no submission gets through without a judge?" and the honest answer was that the dashboard's unassigned-submission nudge was a nudge, not a guarantee. `POST .../results/publish` returns `409 UNJUDGED_SUBMISSIONS` naming the unjudged submissions; `GET .../results/unjudged` lets the dashboard surface the same list before the organizer even tries to publish.
- **FR-RESULT-05**: A rubric's own ranking is always event-wide (every submission it scored, ranked together on one z-score scale), correct as an "overall" ranking, but every submission's placement _within its own track_ is shown alongside it, not just the overall number. Requested explicitly, after finding results showed only the overall ranking with no track-wise breakdown anywhere. Derived from the same computed normalized scores (re-grouped and re-ranked per track, not stored separately), so it's guaranteed consistent with the overall ranking by construction. Pairwise-mode results are unaffected: they were already computed per track (Bradley-Terry strength is only ever estimated within one track's own comparison graph, so there's no mathematically meaningful "overall" to add for that mode). Asked live ("how are results going to show for this pairwise format? I hope results are visible overall as well as track-wise"), the results page now says this explicitly (a short note above the pairwise section explaining why there's no combined ranking across tracks), rather than leaving an organizer to notice its absence and wonder if something's missing.
- **FR-RESULT-05a (results show names, not raw ids)**: Every ranking/tally row on the results page, rubric overall, rubric track-wise, pairwise, and community votes, shows the submission's actual name and its team's name, not a bare id. Found live ("only the submission id is showing up... no one will be able to make out what this even means"): every one of those four tables rendered `submissionId.slice(0, 8)`, an 8-character truncated hex string with no way to tell which project or team it actually was. `ResultsService.submissionInfoMap` is the one join (submissions → teams, scoped to the event) all four tables now share, done once in `assemble()` rather than widening `NormalizationService`/`PairwiseService`/`VotingService`'s own return shapes, those are used elsewhere for raw computation where an id is all that's needed, and shouldn't have to carry display-only fields just because the results page does. `computeTrackRankings` was made generic over its row type so the extra fields flow through its own return type too, not just present at runtime via its `{...row}` spread.
- **FR-RESULT-06**: Once results publish, every participant with a submission is shown their placement, overall rank and each track rank they appear in, whatever the number, not just whoever happened to come first. A prize win is a separate, more specific notification: a submission wins a given prize once its rank (within that prize's own scope, a track's rank if the prize is track-scoped, the overall rank if it's event-wide) is at or better than that prize's `winnerCount` (FR-EVT-01). Requested explicitly, after finding only rank 1 produced any notification or banner at all, silently leaving every other participant with nothing.
- **FR-NOTIF-01**: The notifications bell consolidates three kinds of item: pending-judging reminders, rank/win announcements (FR-RESULT-06), and judge/organizer invites (FR-JASSIGN-01) needing an accept/decline. Requested explicitly, then refined by a follow-up correction: only rank/win items, a one-time fact about a published result, nothing further to do about it, stop reappearing once someone has actually seen them (opening the bell and then closing it again marks everything visible as read; won't resurface on a later poll or page load). Judging reminders and invites both stay visible until actually acted upon: a reminder that a judge has pending work isn't "read and done" just because the bell was opened (the first version of this feature dismissed it on read too, which was wrong, corrected live), and it disappears on its own once its underlying count reaches 0, same as an invite disappears only once accepted/declined (`respondToInvite`), never merely by being seen. There's no notifications table (every item is recomputed live from other tables on each load, not a stored discrete event), so "read" for win/rank is tracked client-side by a stable per-item key (`win:{eventId}`, `rank:{eventId}`, just the eventId since a result is immutable once published), scoped per signed-in user in `localStorage`.

### 3.16 Anti-Abuse (FR-ABUSE)

- **FR-ABUSE-01**: Rate limiting applies to authentication, voting, submission-edit, and comment endpoints.
- **FR-ABUSE-02**: Duplicate-submission detection via content hashing (title/description similarity, thumbnail hash) flags likely resubmissions or scraped content for organizer review.
- **FR-ABUSE-03**: Judge-collusion / low-effort-judging signals (FR-NORM-04) surface on the dashboard.
- **FR-ABUSE-04**: Deadline gaming (attempts to submit/edit after close, clock manipulation via client timestamps) is rejected server-side and logged.
- **FR-ABUSE-05**: An append-only audit log records who did what, when, to which resource, for every sensitive action (auth, role change, score submission/edit, result publish, export, vote). The log is tamper-evident (each entry cryptographically chained to the previous one) and readable by organizers/admins without a database client.

### 3.17 REST API & Webhooks (FR-API)

- **FR-API-01**: Every action available in the UI is available through a documented REST API under a versioned base path.
- **FR-API-02**: A published OpenAPI 3.1 specification describes every endpoint, request/response schema, and required role.
- **FR-API-03**: Webhooks can be registered per event for key lifecycle transitions (submission received, judging complete, results published, certificate issued) with signed payloads and retry-with-backoff on delivery failure.

### 3.18 Certificates & Signed Records (FR-CERT)

- **FR-CERT-01**: The organizer can generate PDF certificates (participation, winner, judge-participation) from a template, populated per recipient.
- **FR-CERT-02**: Judge participation records are cryptographically signed (Ed25519); a public verification endpoint confirms a given record's signature without requiring authentication.

### 3.19 Embeddable Gallery Widget (FR-WIDGET)

- **FR-WIDGET-01**: A read-only, embeddable widget (iframe-able) renders a live or snapshot view of the public gallery for a given event, configurable (track filter, count) via query parameters. Both the widget and the underlying `GET .../gallery` JSON endpoint require the event itself to be visible (`isEventVisible`, FR-EVT-06), not just `galleryVisibility`. Found live while checking the widget was "fully functional in all settings": a still-draft (or not-yet-open automatic-mode) event only ever checked `galleryVisibility`, so an organizer setting it to `open` ahead of launch would leak the event's existence and submissions to anyone who guessed the eventId. An invisible event's gallery 404s (existence itself is information a non-role caller isn't entitled to, same reasoning as `findOne`); its widget renders the same friendly "not public" HTML used for a `hidden`/`participants_only` gallery, rather than a raw error inside someone else's iframe.

### 3.20 Bulk Import / Export (FR-BULK)

- **FR-BULK-01**: An organizer can bulk-import registrations/teams/submissions via CSV with a documented column schema and per-row validation errors reported back (not an all-or-nothing failure). JSON is also accepted as an equivalent alternative, the same endpoint, a `json` field (an array of row objects with the same column names) instead of a `csv` field, added on request, since both are just rows of the same shape and the validation is identical either way, including duplicate handling (requested explicitly, "make sure we don't allow duplicate entries"): a person can be a member of at most one team per event (`assertNotAlreadyOnATeam`, checked for both a `teams` row's owner and every `registrations` row, against existing DB state _and_ earlier rows in the same file, sequential per-row processing means a second row for an already-seated person fails cleanly rather than double-seating them); a team name must be unique within the event (case-insensitive); a team's submission must be unique per track it enters (FR-TEAM-03, a team _can_ hold one submission per track, that's not a bug). CSV values are trimmed of surrounding whitespace by the parser; found live that the JSON path didn't do the same (`" Team A "` vs. `"Team A"` would both pass the `ilike` dedup checks as distinct), now trimmed identically to CSV for exact format parity. Imported submissions are stored as **submitted** (with a `submittedAt`), not drafts: judge assignment and the judging queue only consider submitted projects, so a draft import would leave nothing to judge.
- **FR-BULK-02**: An organizer can export a full event (all entities, relationships intact) as a single archive sufficient to reconstruct the event on another instance: the migration path off the platform. This stays JSON-only, deliberately: it's a relational graph (event → tracks → rubric → criteria, roles → track scopes, teams → members → submissions → assignments → scores...), not a flat resource, so there's no equally simple CSV form for it the way there is for FR-BULK-01/FR-EXP-01's per-resource operations. Importing an archive always creates a brand-new event (the importer becomes its organizer), it never modifies an existing one, so the action lives on the events list page (an alternative to "Create event"), not inside any single event's own dashboard.

## 4. Non-Functional Requirements

### 4.1 Deployment & Operability (NFR-OPS)

- **NFR-OPS-01**: `docker compose up` produces a fully working instance with no external network dependency at runtime (no cloud DB, no hosted auth, no third-party API). A shared reference dataset is loaded automatically; no general-purpose demo account is: the first real account registered is automatically promoted to admin so the operator can begin configuring their own event immediately.
- **NFR-OPS-02**: The instance runs fully offline (network disabled) after images are pulled/built once.
- **NFR-OPS-03**: Structured logs are written to stdout/stderr in a container-friendly format.
- **NFR-OPS-04**: Database schema changes are managed through versioned, forward-only migrations runnable via one command.

### 4.2 Security (NFR-SEC)

- **NFR-SEC-01**: All authorization decisions are enforced server-side; no security-relevant logic exists only in frontend code.
- **NFR-SEC-02**: Secrets (session signing keys, Ed25519 signing keys) are supplied via environment variables / mounted files, never hardcoded, never logged.
- **NFR-SEC-03**: All state-changing endpoints are protected against CSRF; all endpoints validate and reject malformed input (schema validation at the API boundary).
- **NFR-SEC-04**: Dependency and container images are pinned to specific versions for reproducibility.

### 4.3 Performance (NFR-PERF)

- **NFR-PERF-01**: Gallery search/filter and dashboard queries return in well under 1s against a realistic dataset (tens of judges, dozens to low hundreds of submissions per track) on commodity laptop hardware.
- **NFR-PERF-02**: Concurrent judge scoring (multiple judges submitting scores for the same submission simultaneously) does not corrupt aggregate computation (verified under concurrent load).

### 4.4 Data Integrity & Auditability (NFR-AUDIT)

- **NFR-AUDIT-01**: Raw judge scores are immutable once submitted; corrections are new revisions, not overwrites.
- **NFR-AUDIT-02**: The audit log cannot be edited or deleted through any API surface, including by admins (append-only at the schema level).

### 4.5 Usability & Internationalization (NFR-UX)

- **NFR-UX-01**: All deadline/time displays are timezone-aware and rendered in the viewer's local time, stored and computed in UTC.
- **NFR-UX-02**: The UI supports localization (externalized strings) even if only one locale ships initially.
- **NFR-UX-03**: Documentation (README, ARCHITECTURE, DATA-MODEL, JUDGING) is sufficient for an operator unfamiliar with the codebase to run and administer an event without asking the authors.

### 4.6 Portability (NFR-PORT)

- **NFR-PORT-01**: An organizer can export all event data (FR-BULK-02) and self-host elsewhere without vendor lock-in.
- **NFR-PORT-02**: The system has no proprietary or paid-service dependency at any tier.

## 5. Data Requirements

Detailed schema, entity relationships, and import/export column mappings are specified in `DATA-MODEL.md`. At minimum the data model must represent: users, sessions, events, tracks, prizes, teams, team members, invites, submissions (+ versions), custom questions/answers, judge assignments, rubrics, rubric criteria, scores (+ revisions), pairwise comparisons, normalized results, votes, comments, audit log entries, certificates, judge participation records, webhooks, and webhook deliveries.

## 6. Out of Scope

Explicitly excluded:

- Any cloud-hosted database, auth provider, or third-party API as a runtime dependency.
- Frontend-only role/permission checks as the sole enforcement mechanism.
- A gallery without judging, or judging without a gallery.
- Non-OSI-approved licensing.
- Custom hardware or GUI-toolchain dependencies.

## 7. Requirement-to-Capability Traceability

| Capability group                                        | Requirements                                            |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Core (auth, roles, events, teams, submissions, gallery) | FR-AUTH, FR-ROLE, FR-EVT, FR-TEAM, FR-SUB, FR-GAL       |
| Judging                                                 | FR-JASSIGN, FR-SCORE, FR-NORM, FR-PAIR, FR-DASH, FR-EXP |
| Public                                                  | FR-VOTE, FR-COMMENT, FR-RESULT, FR-ABUSE                |
| API / records / operability                             | FR-API, FR-CERT, FR-WIDGET, FR-BULK, all NFRs           |

## 8. Acceptance

Conformance is verified two ways: this project's own automated test suite (`apps/api/src/**/*.spec.ts` — the authorization guards, the audit hash chain, the Bradley-Terry solver, the normalization math, and more), and an end-to-end acceptance check (`run.py`) that makes real HTTP requests against a running instance and reports pass/fail per capability; its output against this repo is `acceptance-report.txt`. Both, plus manual live verification against a running stack throughout development, are the source of most of the fixes captured in this document and `ARCHITECTURE.md`.
