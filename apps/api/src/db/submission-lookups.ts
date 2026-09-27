import { NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Database } from "./client";
import { events, submissions, teams } from "./schema";

// Shared by CommentsService and SubmissionsService, both of which need a
// submission joined through to its event. A plain function taking `db`
// rather than a service, since the two callers live in different feature
// modules and neither should have to depend on the other's module.
export async function loadSubmissionWithEvent(db: Database, submissionId: string) {
  const [row] = await db
    .select({ submission: submissions, team: teams, event: events })
    .from(submissions)
    .innerJoin(teams, eq(teams.id, submissions.teamId))
    .innerJoin(events, eq(events.id, teams.eventId))
    .where(eq(submissions.id, submissionId));
  if (!row) {
    throw new NotFoundException();
  }
  return row;
}
