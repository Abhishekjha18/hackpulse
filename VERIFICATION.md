# HackPulse: Verification Guide

You have this project for the first time and want to confirm it's real: a working product, not a mockup, with a claim you can independently reproduce rather than just read. This document is that walkthrough, in order. Nothing here needs an account you don't create yourself, a cloud service, or an API key.

Total time: about 15 minutes if you follow it straight through.

---

## 1. Check the required files

At the project root you should find:

| File                    | What it is                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`    | One command to a running, seeded-with-reference-data portal                                        |
| `.dogfood.toml`         | Where the running portal's routes are, and which capability tiers are claimed                      |
| `run.py`                | The acceptance checker — makes real HTTP requests against the running portal and reports pass/fail |
| `fixtures.json`         | The shared reference dataset the portal loads at boot                                              |
| `acceptance-report.txt` | The checker's last saved output, committed as a receipt                                            |
| `README.md`             | What it does, the stack, how to run everything                                                     |
| `ARCHITECTURE.md`       | System design and the reasoning behind it, including a changelog of real bugs found and fixed      |
| `DATA-MODEL.md`         | The schema and every entity relationship                                                           |
| `JUDGING.md`            | The scoring and cross-judge normalization math, defended in writing with a worked example          |
| `THREAT-MODEL.md`       | Named attacks against the platform: what's mitigated, and an honest list of what isn't             |
| `LICENSE`               | MIT                                                                                                |

If any of these is missing, stop here — something's wrong with the copy you have.

---

## 2. Bring the stack up

```bash
docker compose up
```

No `.env` file to create, no account to sign up for, nothing to configure first. This starts four containers: `postgres`, `redis`, `api`, `web`. The first boot takes a little longer than a restart (it builds the images), then runs database migrations and loads the reference dataset automatically before the API starts accepting requests.

Wait until all four report healthy:

```bash
docker compose ps
```

Every row should say `healthy` (postgres/redis) or show as `Up` with a passing healthcheck (api/web) — this can take up to a couple of minutes on first boot, a few seconds on later ones. Once it's up:

- API: `http://localhost:3001/api/v1/health` should return `{"status":"ok",...}`
- Web app: `http://localhost:3000` should load

If you stop here entirely and never do anything else, you've already confirmed requirement #1: one command, no external dependency, no cloud account, to a genuinely working instance.

---

## 3. Reproduce the acceptance report yourself

Don't just read the committed `acceptance-report.txt` — regenerate it against the instance you just booted, and confirm it matches.

**a. Get the current session credentials.** These are minted fresh on every boot (they're real, signed login sessions, not fixed constants), so whatever is currently committed in `.dogfood.toml` may already be stale. Pull the current ones from the API container's own logs:

```bash
docker compose logs api | grep -A6 "Test logins"
```

You'll see a block that looks like this (values will differ from what's shown here):

```
Test logins (paste into .dogfood.toml's [auth] section):
  organizer    Cookie: __Secure-hackpulse.session_token=...
  judge_a      Cookie: __Secure-hackpulse.session_token=...
  judge_b      Cookie: __Secure-hackpulse.session_token=...
  participant  Cookie: __Secure-hackpulse.session_token=...
```

**b. Update `.dogfood.toml`.** Open it and replace the four lines under `[auth]` with what you just found. Leave `[portal]`, `[tiers]`, and `[routes]` untouched — the routes point at fixed, pinned identifiers that don't change between boots, only the session cookies do.

**c. Run the checker:**

```bash
python3 run.py .dogfood.toml
```

(Standard library only — any Python 3 works, nothing to install.) You should see:

```
T1  gallery is public ................. PASS
T1  project from fixtures shown ....... PASS
T1  closed event refuses submissions .. PASS
T2  judge sees own scores ............. PASS
T2  judge cannot see peer scores ...... PASS
T2  participant blocked ............... PASS
T2  csv export works .................. PASS

claimed T1 T2 T3 T4, verified T1 T2
note: claimed but not verified: T3 T4
```

All seven checks passing, matching the committed `acceptance-report.txt`, is the independent confirmation that the backend-enforced role isolation, deadline enforcement, and data export are real — not something dependent on trusting the UI or the saved file.

(T3/T4 show as claimed-but-not-verified because this specific checker only exercises T1/T2; the underlying capability for T3/T4 is documented and demonstrable in step 4 below and in `ARCHITECTURE.md`'s own build log.)

---

## 4. Walk through the product yourself

The checker proves the backend behaves correctly. This step confirms the actual product works end to end, using nothing but the browser. Use two browser profiles (or one normal + one incognito window) so you have two separate accounts.

**As Account A** (`http://localhost:3000/register`):

1. Register. Because you're the first real person to ever sign up on this instance, you're automatically an admin and can organize events immediately — no setup step, no config file to edit.
2. `/events/new` — create an event. Pick **Automatic** (set six dates, everything advances on its own) or **Manual** (you move it through its lifecycle by hand from the dashboard) — either is fully supported.
3. From the event's organizer dashboard, **Setup** tab → add a track.
4. Still as the organizer, **Judges** tab → invite yourself as a judge (self-judging is a supported, explicit feature, not a workaround) and accept the invite from your notifications bell.
5. **Setup** tab → create a rubric with at least one weighted criterion.

**As Account B** (a second registration — plain participant, since an organizer/judge can't also register a team on their own event):

6. `/events/:id/team` — create a team, copy the invite code.
7. `/events/:id/submit` — fill in a project, save as a draft, then **Submit for judging**.

**Back as Account A:**

8. Organizer dashboard → assign judges (manual or algorithmic) to the new submission, or confirm your self-judge assignment picked it up automatically.
9. `/events/:id/judge` — open the queue item, score it, submit.
10. Organizer dashboard → **Results** tab → **Publish results** (this is blocked with a clear message if anything submitted is still unjudged — try publishing before step 9 to see that guard fire).
11. `/events/:id/results` — see the published ranking. As Account B, check the notifications bell — you'll see your placement.

That's registration → teams → submission → deadline-bound lifecycle → judge assignment → scoring → normalization → published results, the full pipeline, with nothing pre-built for you.

---

## 5. Explore the reference dataset without building your own

Building judging data from scratch (step 4) proves the product works. This step lets you see what a _populated_ event looks like — real scores, real cross-judge normalization, real outlier detection — without doing that work yourself.

The reference event ("Sample Hack 2026") is loaded automatically at boot from `fixtures.json`, and is visible to everyone in the public gallery with no sign-in at all:

- Browse to `http://localhost:3000/events`, or go directly to `http://localhost:3000/events/d06f00d0-0000-4000-8000-000000000000`.

To see it from the _organizer's_ or a _judge's_ seat — judging progress, the normalization proof, outlier-judge flags — sign in as one of the dedicated accounts `load-fixtures.ts` creates for exactly this purpose (all four share one password):

| Role                                 | Email                                 | Password          |
| ------------------------------------ | ------------------------------------- | ----------------- |
| Organizer of the reference event     | `dogfood-organizer@hackpulse.local`   | `dogfood-check-1` |
| Judge (has submitted one real score) | `dogfood-judge-a@hackpulse.local`     | `dogfood-check-1` |
| Judge (has submitted one real score) | `dogfood-judge-b@hackpulse.local`     | `dogfood-check-1` |
| Participant                          | `dogfood-participant@hackpulse.local` | `dogfood-check-1` |

Signed in as `dogfood-organizer@hackpulse.local`, the organizer dashboard's **Results** tab shows outlier-judge flags computed on the real fixture data — including a judge who scored every single project identically, which the normalization method is specifically designed to neutralize rather than silently average in (the reasoning is in `JUDGING.md`).

---

## 6. Read the written case

For the parts that are arguments, not just running code:

- **`JUDGING.md`** — assignment strategy, the scoring formula, and the cross-judge normalization method, with the actual math and a worked example showing a raw-score ranking flip once judges' personal scales are accounted for.
- **`THREAT-MODEL.md`** — named attacks (sybil voting, ballot stuffing, judge collusion, deadline gaming, and more), each marked mitigated with a code reference, or honestly not.
- **`ARCHITECTURE.md`** — system design, module boundaries, and a set of Architecture Decision Records that include real bugs found while building this and how they were fixed, not just the final clean design.
- **`DATA-MODEL.md`** — the schema, in enough detail to defend in a conversation.

---

If every step above worked as described, you've independently confirmed: the backend enforces its own claimed security properties (not just the UI), the full product lifecycle works with real accounts you created, and the documentation's claims match what's actually running.
