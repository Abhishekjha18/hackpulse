# HackPulse: Judging

How submissions get assigned to judges, how a raw score becomes a rank, and why. This document is the "defend the maths in writing" deliverable the brief asks for: every claim below is backed by code you can read (`apps/api/src/judging/`) and by a live test that actually exercised it, not just a unit test with tidy numbers.

## 1. Assignment strategy

Two modes, both structurally track-scoped (`AssignmentsService`, `apps/api/src/judging/assignments.service.ts`):

- **Manual**: an organizer picks specific (submission, judge) pairs directly. Each pair is checked against `judge_track_scopes` before insertion: a judge who isn't scoped to a submission's track is silently skipped, with the reason reported back (`skipped: [...]`), not just dropped.
- **Algorithmic**: given a track and a minimum judge count, every submitted project in that track gets assigned to `min(minJudgesPerSubmission, judges.length)` _distinct_ judges, chosen by rotating the starting offset into the judge pool once per submission. This spreads load roughly evenly without needing a full bin-packing solve: for hackathon-scale numbers (tens of judges, dozens to low hundreds of submissions per track), simple rotation converges to a near-uniform per-judge assignment count, and doesn't require every judge to be online simultaneously the way an auction-style allocator would.

**Why track-scoping is structural, not just a read-time check**: an assignment is _never created_ unless the judge already holds a `judge_track_scopes` row for that track. This means `AssignmentOwnershipGuard` doesn't need a separate "is this judge allowed to see this track" check on every score read: ownership of the assignment _is_ proof of track scope, because there is no code path that creates a cross-track assignment in the first place. This is the same reasoning `ARCHITECTURE.md` §6 gives for the guard design: a judge literally has no assignment outside their track to leak.

**Conflict-of-interest exclusion (FR-JASSIGN-02)**: the most severe conflict (a judge who is literally on the submitting team) can't happen at all, structurally: `TeamsService` refuses to let anyone who holds an organizer or judge role on an event also create or join a team on it, and `EventRoleInvitesService.accept` refuses the reverse (a participant accepting a judge/organizer invite for an event they're already on a team in). The remaining case (a judge with no team relationship but a _declared_ affiliation with a team member) is checked by `AssignmentsService.conflictedJudgeIds`, which compares each candidate judge's profile `workplace` against every member of the submission's team, case-insensitively; an empty/unset workplace never matches anything, including another empty one. Algorithmic assignment hard-excludes a conflicted judge from that submission's rotation (the pool still rotates against every scoped judge for later submissions, so overall load-spreading isn't skewed by one submission's exclusions). Manual assignment only warns: a conflicted pair comes back in `skipped` with the reason, and the organizer can force it through for that specific pair (`force: true`); track-scoping has no such override, but this one is a declared-affiliation heuristic, not a structural guarantee, so an organizer with more context can override it.

## 2. Scoring

A rubric (`RubricsService`) is a named set of criteria, each with a weight; weights are validated to sum to 1.0 ± 0.001 at rubric-creation time (not left for the scoring math to silently absorb a typo). A judge scores each criterion on the rubric's configured scale (default 1–5); the raw weighted score for one judge's evaluation of one submission is

```
raw = Σ (criterion_value_i × criterion_weight_i)
```

computed server-side on submit (`ScoringService.submit`), never trusted from the client. A submitted score's raw value is immutable in the sense that matters: any later edit (`ScoringService.save`, when `status` is already `submitted`) first writes the pre-edit snapshot to `score_revisions` before applying the change: "we averaged the scores and moved on" never happens silently here; every correction is a visible, attributed revision.

## 3. Cross-judge normalization: per-judge z-score

**The problem**: raw scores from different judges are not comparable. A judge who scores everything 4–5 and one who scores everything 2–3 are not necessarily disagreeing about quality: they may simply anchor to different points on the scale. Averaging raw scores directly (`"we averaged the scores"`, the exact answer the brief calls out as weak) lets a judge's personal calibration dominate the outcome over their actual opinion of relative quality.

**The method** (`NormalizationService.recompute`): for each judge _j_, over every score they've submitted under a given rubric, compute their own mean μ_j and population standard deviation σ_j. A raw score _r_ from judge _j_ normalizes to

```
z = (r − μ_j) / σ_j
```

This is how many of _that judge's own_ standard deviations above or below their personal average this particular score is. A submission's normalized score is the mean of its z-scores across every judge who scored it; **that** is what gets ranked, not the raw mean.

**The degenerate case, handled deliberately**: if σ_j = 0 (a judge whose every submitted score is identical, the exact "everyone's a 3" scenario the brief names), every one of that judge's z-scores is defined to be exactly 0. This is not a workaround for a division-by-zero crash; it is the intended statistical answer. A judge who provides no discriminating signal at all should move nobody's rank, in either direction, rather than being averaged in at face value (which raw-score averaging would do) or excluded and losing their signal on submissions other judges didn't see. Normalization absorbs the _mathematical_ effect; a human still decides whether to talk to that judge: which is what `FR-NORM-04` is for.

**`FR-NORM-04`: outlier judges, surfaced for organizer review** (`NormalizationService.getOutlierJudges`, `GET .../results/outlier-judges`): two independent signals, either of which flags a judge without discarding their scores. (1) _Near-zero variance_: σ_j below 0.001 with at least 2 submitted scores, i.e. the degenerate case above, made visible rather than just silently corrected for. (2) _Diverges from peer consensus_: for every submission this judge scored that at least one other judge also scored, compare this judge's z-score against the mean z-score of everyone else who scored it; a Pearson correlation below −0.3 across at least 3 shared submissions means this judge's _relative ranking_ of submissions runs opposite to their peers', which calibration correction (the z-score itself) doesn't touch: a judge who's simply pickier still ranks submissions the same way as everyone else and would never trip this. Verified against constructed data with a known answer: two judges scoring in the same relative order, a third scoring in the exact opposite order (r = −1, flagged), and a fourth scoring every submission identically (flagged for variance, not correlation: an all-identical series has no ordering signal, so its correlation is reported as 0, not spuriously negative).

### Worked example (real numbers from a live run, reproducible on demand)

An earlier version of this section hand-waved the arithmetic: the printed μ/σ didn't actually reconcile with the printed raw scores if you multiplied it out. Found doing exactly the "would a statistician wince" check this document asks for. Replaced with a minimal scenario built and scored through the real HTTP API (not seeded, not hand-typed into this file), with the arithmetic checked independently before it went in.

**Setup**: one throwaway event, one track, one rubric (single criterion "Overall", weight 1.0, scale 1–5), two submissions, two judges, created via `POST /events`, `POST .../tracks`, `POST .../judging/rubrics`, `POST .../judges/self` (the organizer self-judging) and the real invite→accept flow (a second account, invited as a judge), `POST .../submissions` + `POST .../submissions/:id/submit`, then `POST .../judging/assignments` (manual, both judges to both submissions). Deleted immediately after capturing the output below.

|       | Judge 1 (the organizer, generous) | Judge 2 (the invited judge, harsh, but relatively favors Beta) |
| ----- | --------------------------------- | -------------------------------------------------------------- |
| Alpha | 5                                 | 1                                                              |
| Beta  | 4                                 | 3                                                              |

Judge 1: μ = (5+4)/2 = 4.5, σ = √(((5−4.5)² + (4−4.5)²)/2) = 0.5 → z(Alpha) = (5−4.5)/0.5 = **+1.0**, z(Beta) = (4−4.5)/0.5 = **−1.0**
Judge 2: μ = (1+3)/2 = 2.0, σ = √(((1−2)² + (3−2)²)/2) = 1.0 → z(Alpha) = (1−2)/1.0 = **−1.0**, z(Beta) = (3−2)/1.0 = **+1.0**

**Raw means**: Alpha = (5+1)/2 = **3.0**, Beta = (4+3)/2 = **3.5**: naive averaging picks **Beta**.
**Normalized means**: Alpha = (+1.0 + −1.0)/2 = **0.0**, Beta = (−1.0 + +1.0)/2 = **0.0**: a **dead heat** once each judge's personal scale is accounted for.

Actual, unedited response from `GET /events/:eventId/judging/results/normalization-proof?rubricId=...` for this exact scenario:

```json
[
  {
    "submissionId": "<Alpha>",
    "rawMean": 3,
    "normalizedMean": 0,
    "rankByRawAlone": 2,
    "rankByNormalized": 1,
    "rankChanged": true
  },
  {
    "submissionId": "<Beta>",
    "rawMean": 3.5,
    "normalizedMean": 0,
    "rankByRawAlone": 1,
    "rankByNormalized": 2,
    "rankChanged": true
  }
]
```

Every number above was independently computed by hand first, then matched exactly against this live response; nothing here was reverse-engineered from the output. One honest wrinkle worth naming rather than glossing over: normalization correctly reports both submissions as tied at `0`, but `rank` still has to pick an order (1 and 2, not "tied"): `getResults`' sort is stable, so on an exact tie the rank is decided by insertion order (effectively, database read order), not by any further quality signal. A true tie in `normalizedMean` should be read as "these are statistically indistinguishable under this method," regardless of which one the `rank` field happens to list first.

## 4. Pairwise mode: Bradley-Terry (the Gavel/HackMIT approach)

An alternative to rubric scoring, selectable per event (`event.scoringMode = 'pairwise'`): instead of an absolute score, a judge is shown two submissions and asked which is better. This sidesteps cross-judge calibration entirely: there is no personal scale to normalize, because no judge ever produces an absolute number.

**The model** (`bradley-terry.ts`): each item _i_ has a latent strength π_i > 0, with P(i beats j) = π_i / (π_i + π_j). Strengths are fit by minorization-maximization (Hunter, 2004):

```
π_i ← W_i / Σ_j (n_ij / (π_i + π_j))
```

where _W_i_ is total wins and _n_ij_ is the number of comparisons against opponent _j_. A tie is treated as half a win for each side: a defensible, simple extension (ties genuinely convey "couldn't distinguish them," not a coin flip toward one side).

**Regularization (found necessary by a live test, not assumed up front)**: unregularized Bradley-Terry is degenerate for any item with a _perfect_ record. With only three comparisons (A beat B, A beat C, B beat C), A's unregularized MLE strength diverges toward infinity: in testing, iterating the raw MM update produced values like `999999999999995136`, which overflowed the `pairwise_rankings.bt_strength` column (`numeric(10,6)`) and threw a real `500` on the live stack. This is exactly the kind of failure a synthetic unit test with generous, mixed win/loss records wouldn't have surfaced; it took an actual end-to-end run with sparse data to find it. The fix is a standard one: give every item one fictional win and one fictional loss against a phantom opponent pinned at strength 1 (`REGULARIZATION = 1` in `bradley-terry.ts`), a weak empirical-Bayes prior toward "average" that only meaningfully moves an estimate when real data is thin, exactly the regime where the unregularized estimate is least trustworthy anyway. A regression test (`bradley-terry.spec.ts`, "stays finite and bounded for a perfect record on sparse data") reproduces the exact scenario that broke in production and asserts it stays bounded.

**Ranking uncertainty**: `bootstrapConfidenceIntervals` refits the model on resamplings-with-replacement of the observed comparisons (default 100 samples) and reports the 2.5th/97.5th percentile of each item's strength: a ranking based on three comparisons is reported _with a wide interval_, not with false precision. This is what `FR-PAIR-04` asks for and what a statistician would look for before trusting a leaderboard built from sparse pairwise data.

**Selection strategy** (`PairwiseService.getNextPair`): rather than uniform random sampling, the next pair offered to a judge prefers submissions that judge has compared least, and never re-serves a pair that judge has already voted on. This converges comparison coverage faster than pure randomness for the same number of judge-actions. Once every possible pair in a track has been compared exactly once, the endpoint returns `409 ALL_PAIRS_COMPARED` rather than a pair. An earlier version fell back to re-serving a pair once every pair had been seen once, on the assumption that more comparisons always sharpen the ranking; found live, this was a real bug, not a feature: because the "least-compared" tiebreak recomputes fresh counts on every call, voting on an already-compared pair again just shifted which pair now looked least-compared next, so instead of settling on one static repeat it quietly rotated through every pair in the track forever. Reported live as "the judge is stuck in a loop... these comparisons keep repeating." `compare()` independently rejects (`409 ALREADY_COMPARED`) a repeat of a pair the judge already voted on, so a stale frontend or a direct API call can't reintroduce the same problem. A track being exhausted for one judge is tracked per (judge, track) via `PairwiseService.getProgressForJudge`/`getProgressForOrganizer` (`GET .../pairwise/progress`, self-scoped; `GET .../pairwise/organizer-progress`, every judge on every track), the pairwise analog of the rubric-mode judging queue and progress table.

## 5. What this does not claim

- Normalization and pairwise mode are two different, non-combinable scoring strategies per event (`event.scoringMode`), not fused into one meta-score. Comparing a rubric-scored track against a pairwise-scored track head-to-head is not attempted, because the underlying statistics aren't on the same scale and pretending otherwise would be exactly the kind of unearned precision this document is trying to avoid.
- Judge-reliability _detection_ (flagging a judge whose pattern looks like collusion, not just zero variance) is not built; only the zero-variance case is handled automatically. See `THREAT-MODEL.md` §4 for what is and isn't covered on the collusion side specifically.
- The z-score method assumes each judge has scored enough submissions for μ_j/σ_j to be meaningful. A judge with exactly one submitted score has σ_j = 0 by construction (a single point has no variance) and is therefore treated identically to the "everyone's a 3" case: normalizing to 0. This is a real edge case worth an organizer's attention (the dashboard should flag judges with very few completed assignments before judging closes), not a bug, but it is a limitation of any per-judge-scale method applied to too little data.
