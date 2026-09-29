# Welcome to HackPulse: a first-timer's guide

New here? This guide walks you through HackPulse the same way a real hackathon unfolds: you look around, make an account, set up an event, form teams, submit projects, judge them, vote, publish results, and hand out certificates. Every screenshot was taken from a live copy of the app while a small demo event ("Guide Jam 2026") was run from start to finish, so what you see here is what you'll see on your screen.

You don't have to read it front to back. Each part stands on its own, so jump to the role you care about.

## Contents

1. [What HackPulse is](#1-what-hackpulse-is)
2. [Getting it running](#2-getting-it-running)
3. [Look around without an account](#3-look-around-without-an-account)
4. [Make your account](#4-make-your-account)
5. [If you're running an event (organizer)](#5-if-youre-running-an-event-organizer)
6. [If you're joining an event (participant)](#6-if-youre-joining-an-event-participant)
7. [If you're judging (judge)](#7-if-youre-judging-judge)
8. [Keeping an eye on judging](#8-keeping-an-eye-on-judging)
9. [Voting and comments](#9-voting-and-comments)
10. [Publishing results](#10-publishing-results)
11. [Certificates](#11-certificates)
12. [Data, exports and the audit log](#12-data-exports-and-the-audit-log)
13. [Profiles and admin tools](#13-profiles-and-admin-tools)
14. [Who can do what](#14-who-can-do-what)
15. [Good to know](#15-good-to-know)

---

## 1. What HackPulse is

HackPulse is a hackathon portal you host yourself. It covers the whole journey in one place: registration, teams, project submissions, judging, results, and certificates. There's no cloud account to set up and no email service to connect. Everything runs on your own machine.

Five kinds of people use it:

| Role            | What they do                                                                       |
| --------------- | ---------------------------------------------------------------------------------- |
| **Visitor**     | Browses public events and project galleries. No account needed.                    |
| **Participant** | Joins a team and submits a project.                                                |
| **Judge**       | Scores the projects they've been assigned.                                         |
| **Organizer**   | Creates and runs events: tracks, prizes, rubrics, judges, and publishing results.  |
| **Admin**       | The person who set up the instance. Can grant others the right to organize events. |

One person can wear different hats on different events. You might organize one event, judge another, and compete in a third.

## 2. Getting it running

You need Docker installed. From the project folder, run:

```bash
docker compose up
```

That starts the database, the queue, the API, and the website. When it settles, open **http://localhost:3000** in your browser.

A sample event called **Sample Hack 2026** is already loaded so the place isn't empty. It has real-looking projects, judges, and scores, and it's the same on every copy of HackPulse. Don't worry about breaking it.

## 3. Look around without an account

You can explore a lot before signing up.

### The home page

The home page shows a few live numbers (events, projects, teams, participants, judges) and a short tour of what the product offers. Scroll down for the events that are happening now.

![The HackPulse home page for a signed-out visitor](docs/guide/01-home.png)

### Browse events

Click **Events** in the top bar to see everything that's public. Each card shows the event's status, a short description, how many projects it has, and its prizes.

![The events list, showing two event cards](docs/guide/02-events-list.png)

Once you're signed in, this page also gives you **Active**, **Past**, and **My Events** tabs, plus a **Create event** button and an **Import from archive** option (more on those later).

### Open an event

Click any event to see its page: the banner, what stage it's in, the prizes on offer, and a gallery of submitted projects you can search and filter by track.

![Sample Hack 2026's event page with its gallery](docs/guide/03-event-page.png)

The gallery only shows projects that have been submitted, not half-finished drafts. Organizers decide whether a gallery is fully public, visible to participants only, or hidden.

### Open a project

Click a project card to see its full description, links, and comments.

![A single project's detail page](docs/guide/05-submission-detail.png)

### Search everything

The magnifying glass in the top bar searches across events, projects, and people at once.

![Search results for the word "signal"](docs/guide/04-search.png)

## 4. Make your account

Click **Register** in the top right. You only need a name, an email, and a password of at least 10 characters.

![The registration form](docs/guide/06-register.png)

After you register you're signed in straight away, and you'll see your name and a few new links in the top bar: **My teams**, **Certificates**, and a notifications bell.

![The home page after signing in](docs/guide/07-signed-in-home.png)

> **The first account is special.** The very first real person to register on a fresh copy of HackPulse is automatically made the **admin**. Everyone after that starts as a regular participant. So if you're setting this up for your own event, be the first to register. (The sample event's built-in accounts don't count toward this.)

Coming back later? Use **Sign in**.

![The sign in page](docs/guide/44-login.png)

### Two small comforts

- **Dark mode.** The moon icon in the top bar flips the whole site to a dark theme. It remembers your choice.
- **The notifications bell.** Judge invites, co-organizer invites, "you have judging to do" reminders, and your results all show up here. More on each below.

![The event page in dark mode](docs/guide/45-dark-mode.png)

## 5. If you're running an event (organizer)

To create events you need organizer permission. As the first user (the admin), you already have it. Anyone else needs an admin to grant it from their profile page (see [Profiles and admin tools](#13-profiles-and-admin-tools)).

### Create the event

Go to **Events** and click **Create event**. Give it a name and a description. The web address (slug) is worked out from the name if you leave it blank.

The big choice is how the event's schedule works. Pick carefully, because **you can't change it later**:

- **Automatic.** You set six dates up front: when registration opens and closes, when submissions open and close, and when judging opens and closes. The event moves through its stages by itself as the clock passes each date. It becomes visible to the public the moment registration opens.
- **Manual.** No dates at all. You move the event from stage to stage yourself, whenever you're ready. This is the easiest way to run a small or casual event, and it's what we used for the demo.

You can also list co-organizers by email here. They get an invite in their notifications bell and have the same powers as you once they accept.

![The create event form with manual mode selected](docs/guide/08-create-event.png)

When you click **Create event**, you land on the new event's page. As an organizer you'll see extra buttons for the dashboard.

![The new event's page, seen by its organizer](docs/guide/09-event-page-organizer.png)

### The organizer dashboard

The dashboard has five tabs: **Overview**, **Setup**, **Judges**, **Results**, and **Data**. It opens on **Overview**, where the event settings live:

- **Status**: where the event currently stands.
- **Scoring mode**: whether judges score with a rubric or compare projects head to head (see [judging](#7-if-youre-judging-judge)).
- **Gallery visibility**: open, participants only, or hidden.
- **Voting mode and access**: whether community voting is on, and who may vote.
- **Banner image URL**: paste a link to give the event its own banner. Leave it blank for a generated one.

![The organizer dashboard's Overview tab on a brand new event](docs/guide/10-dashboard-overview.png)

### Event stages

Every event moves through these stages in order:

**draft, registration open, submissions open, judging, results published, archived**

In manual mode, you use the **Status** dropdown to advance. It only ever offers the very next stage, so you can't skip ahead by accident. Going backward is allowed, but only while it wouldn't mess up real data (for example, you can't go back to registration once projects have been submitted).

Results are published with a dedicated button, not this dropdown, and archiving is only possible after results are out.

![Moving the event forward using the Status dropdown](docs/guide/13-dashboard-status.png)

### Set up tracks, prizes, and a rubric

Open the **Setup** tab. Here you'll find:

- **Add a track.** Tracks are categories like "Web & Mobile" or "AI/ML". Type a name or click one of the quick suggestions.
- **Co-organizers.** Invite more organizers by email.
- **Prizes.** Give each prize a name, choose whether it's for one track or the whole event, and say how many winners it has (top 1, top 3, and so on).
- **Create a rubric.** A rubric is the scoring sheet judges will use. Each criterion gets a weight, and the weights must add up to exactly 1.00. The form shows a running total and won't let you save until it hits 1.00.

![The Setup tab before anything has been added](docs/guide/11-dashboard-setup.png)

Here's the same tab after adding two tracks, a prize with three winners, and a five-criterion rubric:

![The Setup tab with tracks, a prize, and a finished rubric](docs/guide/12-dashboard-setup-rubric.png)

## 6. If you're joining an event (participant)

### Find an event and join in

Open an event that's in the registration stage. As a signed-in participant you'll see **My team** and **Submit a project** buttons next to the event title.

![An event page during registration, as a participant sees it](docs/guide/14-event-page-participant.png)

### Create or join a team

Click **My team**. You have two options: create a team, or join an existing one with an invite code.

![The team page with the create and join forms](docs/guide/15-team-create-or-join.png)

Once your team exists, you'll see its **invite code**. Share that code with your teammates.

![A newly created team with its invite code](docs/guide/16-team-page.png)

Teammates open the same page, paste the code into **Invite code**, and join. Teams hold up to four people by default.

![A teammate pasting an invite code to join](docs/guide/17-team-join.png)

A few rules worth knowing:

- The team owner can generate a fresh invite code (which cancels the old one) and can remove members.
- Members can leave a team before the deadline.
- If you're an organizer or judge on an event, you can't also compete in it. That keeps things fair.
- Your teams across every event are listed under **My teams** in the top bar.

### Submit your project

When the event reaches the submissions stage, click **Submit a project**. Fill in the name, choose a track, and add a tagline, a description, and your links.

![The project submission form, filled in](docs/guide/18-submit-form.png)

You can **Save draft** as often as you like. Nothing is judged until you make the final submit.

![A draft saved successfully](docs/guide/19-submit-draft-saved.png)

Once submitted, your project is locked in for judging.

![A submitted project](docs/guide/20-submitted.png)

> **Heads up:** you can still edit a submitted project before the deadline, but doing so turns it back into a draft. You'll need to submit it again. That's on purpose, so judges never score something half-edited.

If the organizer added custom questions, they appear on the form too. A team can enter one project per track.

## 7. If you're judging (judge)

### Getting invited

Organizers invite judges by email, and the person must already have an account. They also choose which tracks each judge can see.

![The organizer inviting a judge and choosing their tracks](docs/guide/21-invite-judge.png)

You'll see the invitation in your **notifications bell**. Accept it, or decline it if it's not for you.

![A judge invite waiting in the notifications bell](docs/guide/22-notifications-invite.png)

After accepting, the event page shows you a link to your judging queue.

![The event page after accepting a judge invite](docs/guide/23-event-page-judge.png)

> Organizers can also judge their own event using **Judge this event yourself** on the Judges tab.

### How projects get assigned to judges

On the organizer's **Judges** tab there are two ways to hand out work:

- **Algorithmic.** Pick a track and how many judges each project needs. HackPulse spreads the work evenly, and avoids matching a judge with a project from a teammate who works at the same place as them.
- **Manual.** Tick specific projects and specific judges and pair them up yourself.

A judge only ever sees the projects assigned to them, and only in tracks they were invited to.

![The Judges tab after assignments were created](docs/guide/24-assign-judges.png)

### Your judging queue

Open **Your judging queue** to see everything assigned to you and its status.

![A judge's queue with three projects to score](docs/guide/25-judge-queue.png)

### Scoring a project

Click a project to see its details and the scoring sheet. Slide each criterion to your score (the default scale is 1 to 5) and add optional written feedback.

![The scoring page with sliders for each criterion](docs/guide/26-judge-scoring.png)

You can **Save draft** and come back later. Only **Submit score** counts toward the results. If you change a submitted score afterwards, the old version is kept in a history, so nothing is ever silently overwritten.

![A score after it was submitted](docs/guide/27-judge-score-submitted.png)

Back in the queue, finished projects are marked **completed**.

![A queue with two projects completed](docs/guide/28-judge-queue-done.png)

### Pairwise mode: judging by comparison

Not every event wants sliders and weights. Pairwise mode swaps the scoring sheet for a much simpler question: "which of these two is better?" There's no personal scale to worry about, because nobody ever gives a number.

**Turning it on.** An organizer opens the dashboard's Overview tab and sets **Scoring mode** to **pairwise**. It applies to the whole event, so you can't mix rubric and pairwise across tracks. The demo event below has a single track called "Open Pitch" and three projects.

![The Overview tab with Scoring mode set to pairwise, and a judge who hasn't started yet](docs/guide/46-scoring-mode-pairwise.png)

Notice the **Judging progress** table underneath. In pairwise mode it shows one row per judge and track, counting how many pairs that judge has compared out of the total possible. For a track with three projects there are three possible pairs, so the judge here is at 0 of 3.

**Judging by comparison.** A judge opens the same judging link as before and sees two projects side by side. Each card shows the name, tagline, and tags, plus an **Open full submission** link that opens the whole project page in a new tab if you want a closer look. Click **This one is better** under the winner, or **Can't tell / tie** if you honestly can't separate them.

![A judge choosing between two projects](docs/guide/47-pairwise-judging.png)

HackPulse picks the next pair for you, favouring projects you've compared least, and you'll never be shown the same pair twice. Keep going until you see the finish message:

![The message a judge sees after comparing every pair in a track](docs/guide/49-pairwise-done.png)

**Watching progress.** Back on the organizer's Overview tab, the judge now shows as done (3 of 3). Because a project's coverage isn't one simple number in this mode, the per-submission coverage table is replaced by a short note pointing you to the judge and track table.

![The organizer dashboard showing a judge who finished all comparisons](docs/guide/50-pairwise-organizer-progress.png)

**Reading the results.** Behind the scenes, HackPulse turns all those head-to-head picks into a ranking using a well-known method called Bradley-Terry. The results page shows each project's **strength** (1.000 is average, higher is stronger) and a **95% CI** range, which is how sure the ranking is. With only a few comparisons the range is wide, and it tightens as more judges weigh in. Rankings are shown per track only, with no combined overall list, because strengths from different tracks can't be fairly put on the same scale.

![Pairwise results with strength scores and confidence ranges](docs/guide/51-pairwise-results-preview.png)

The publishing steps in [Publishing results](#10-publishing-results) work exactly the same for pairwise events.

## 8. Keeping an eye on judging

Back on the organizer dashboard, the **Overview** tab now tells you how judging is going.

- **Judging progress** shows each judge and how many of their projects they've finished.
- **Per-submission coverage** shows how many judges have scored each project.

It refreshes on its own every thirty seconds, so you can leave it open.

![Judging progress and per-submission coverage](docs/guide/29-dashboard-progress.png)

The **Results** tab adds a few safety nets:

- **Publish results** and **View results** buttons.
- **Vote tally**, visible to organizers only until results go public.
- **Outlier judges.** If a judge gave everything the same score, has too few scores, or ranks projects the opposite way to everyone else, they're flagged here for you to take a look. Their scores still count. It's a prompt, not a punishment.
- **Duplicate submissions.** Flags projects that look like copies of each other.

![The Results tab, ready to publish](docs/guide/30-dashboard-results.png)

### Why scores are "normalized"

Some judges are generous and some are harsh. If you just averaged raw scores, the outcome could depend more on who happened to judge you than on how good your project was. HackPulse adjusts for this by comparing each judge's scores to that judge's own average and spread, then ranking on the adjusted numbers. You can always see both the raw and the adjusted score. The full explanation, with a worked example, is in [JUDGING.md](JUDGING.md).

## 9. Voting and comments

### Community voting

Organizers can switch on voting from the Overview tab. There are two styles:

- **Single vote:** one vote per person per project.
- **Quadratic:** each person gets a budget of "voice credits", and casting more votes on one project costs more, so people spread their support around.

Organizers also choose who may vote: anyone with the link, people who enter an email, or only signed-in users.

Voters see a ballot with the projects in a random order, so nobody gets an unfair spot at the top.

![The voting ballot](docs/guide/32-vote-ballot.png)

After voting you get a confirmation.

![A vote was recorded](docs/guide/33-vote-cast.png)

Vote counts stay hidden from everyone except organizers until results are published.

### Comments

Anyone signed in can leave a comment on a project's page. Organizers can remove comments that don't belong (they're hidden rather than erased, so there's still a record).

![A comment on a project page](docs/guide/41-submission-comments.png)

## 10. Publishing results

Nothing is public until the organizer says so. Scores, rankings, and vote tallies stay private until then.

### Preview first

Click **View results** to see exactly what everyone will see, before it goes live.

![The results preview, visible only to organizers](docs/guide/34-results-preview.png)

### Publish

When you're happy, click **Publish results**. Two things must be true first:

1. Every submitted project has been judged at least once.
2. Judging is actually over (the judging window has closed in automatic mode, or the event is in the judging stage in manual mode).

If some projects are still unjudged, HackPulse tells you which ones.

![The dashboard right after publishing results](docs/guide/35-results-published.png)

### What everyone sees afterwards

The results page shows the overall ranking with raw and adjusted scores, then a separate ranking inside each track, and the community vote totals. Every row shows the project name and the team behind it.

![The public results page](docs/guide/37-results-public.png)

Participants get a personal touch too. Every team is shown where it placed, and a team that wins a prize gets a congratulations banner on the event page. A prize is won when a team's rank is within that prize's number of winners.

![A winning team's event page with a congratulations banner and placement](docs/guide/38-event-page-after-results.png)

Both of these also show up in the notifications bell.

## 11. Certificates

Open the **Data** tab and find **Certificates**. Choose a type:

- **Participation**
- **Winner**
- **Judge**

Then tick the people who should get one and click **Generate**. The PDFs are built in the background, so they can take a few seconds to appear.

![The Data tab's certificate section, with recipients ticked and the audit log above it](docs/guide/36-certificates-generated.png)

Everyone can find their certificates under **Certificates** in the top bar and download them from there.

![My certificates page with a download button](docs/guide/39-my-certificates.png)

Judges also get a **signed judge-participation record**. It carries a digital signature, and anyone can check that it's genuine without an account. That's handy for a judge who wants to prove they took part.

## 12. Data, exports and the audit log

The **Data** tab is the organizer's toolbox.

![The Data tab: exports, audit log, certificates, bulk tools and the widget](docs/guide/31-dashboard-data.png)

- **Export.** Download registrations, teams, submissions, assignments, scores, normalized results, pairwise rankings, votes, and the audit log. Each comes as CSV or JSON, with identical rows either way.
- **Audit log.** A running record of who did what and when (submitting a score, granting a role, publishing results, and so on). It's tamper-evident: each entry is chained to the one before it, and the page tells you whether the chain still checks out. Nobody can edit or delete entries, not even an admin.
- **Bulk export and import.** Download the whole event as one archive to move it to another HackPulse instance, or import teams, registrations, and submissions from a CSV or JSON file. Bad rows are reported back one by one instead of failing the whole file. To recreate an event from an archive, use **Import from archive** on the Events page.
- **Embeddable gallery widget.** Copy a small snippet of code to show your project gallery on your own website. You can filter by track, set how many projects to show, and pick light or dark.

Webhooks (automatic notifications sent to another system when something happens) exist too, but they're managed through the API rather than a page. The API is fully documented in [docs/openapi.yaml](docs/openapi.yaml).

## 13. Profiles and admin tools

### Your profile

Click your name in the top bar to edit your profile: where you work, a short bio, your skills, and links to GitHub, LinkedIn, or a website. You choose which of these fields other people can see.

![Editing a profile](docs/guide/40-profile-edit.png)

### Granting organizer access (admin only)

When an admin opens someone else's profile, they see an **Organizer access** box. Click **Grant organizer access** to let that person create and run events. There's no way to make a second admin, by design.

![An admin viewing a participant's profile with the organizer control](docs/guide/42-admin-grants-organizer.png)

### The instance-wide audit log (admin only)

Admins get an **Audit log** link in the top bar. It records site-wide actions that don't belong to a single event, like sign-ups and sign-ins, and it also verifies its own chain.

![The instance-wide audit log](docs/guide/43-admin-audit-log.png)

## 14. Who can do what

| Action                                     | Visitor | Participant | Judge | Organizer | Admin |
| ------------------------------------------ | :-----: | :---------: | :---: | :-------: | :---: |
| Browse events and public galleries         |   Yes   |     Yes     |  Yes  |    Yes    |  Yes  |
| Comment on projects                        |   No    |     Yes     |  Yes  |    Yes    |  Yes  |
| Create or join a team, submit a project    |   No    |     Yes     | No\*  |   No\*    | No\*  |
| Score assigned projects                    |   No    |     No      |  Yes  |    No     |  No   |
| Create events and run the dashboard        |   No    |     No      |  No   |    Yes    |  Yes  |
| Invite judges and co-organizers            |   No    |     No      |  No   |    Yes    |  Yes  |
| Publish results and issue certificates     |   No    |     No      |  No   |    Yes    |  Yes  |
| Grant others permission to organize events |   No    |     No      |  No   |    No     |  Yes  |

\* Not on an event where they organize or judge. Roles belong to an event, so someone can compete in one event and judge another.

Being an admin does not automatically make you an organizer of everyone's events. You only get organizer powers on events you created or were invited to run.

## 15. Good to know

- **No emails are sent.** There's no email service, so judge invites arrive in the notifications bell of an existing account, and there's no "forgot password" email. This is deliberate, because HackPulse runs with no outside services.
- **Deadlines are enforced by the server.** Changing your computer's clock won't get you extra time.
- **Trying the sample event's roles.** The sample event comes with test accounts. Every one uses the password `dogfood-check-1`. For example, `dogfood-organizer@hackpulse.local` organizes it and `dogfood-judge-a@hackpulse.local` judges it. These are public, so remove them before putting HackPulse on the internet.
- **Starting fresh.** Run `docker compose down -v` to wipe everything, then `docker compose up` for a clean copy with a new "first account becomes admin" moment.
- **Want the deep dive?** [REQUIREMENTS.md](REQUIREMENTS.md) lists every feature, [ARCHITECTURE.md](ARCHITECTURE.md) explains how it's built, [JUDGING.md](JUDGING.md) explains the scoring maths, and [THREAT-MODEL.md](THREAT-MODEL.md) covers security.

Happy hacking!
