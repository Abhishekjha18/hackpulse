import { AUDIT_ACTION, ERROR_CODE, EVENT_STATUS } from "@hackpulse/shared";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { AuditService } from "../audit/audit.service";
import type { Database } from "../db/client";
import { events } from "../db/schema";
// FR-EVT-01 names "judging window" as a real, organizer-set field
// alongside registration/submission windows, but unlike those two it was
// never enforced: a judge could score or compare before judgingOpenAt or
// after judgingCloseAt with nothing stopping them. Shared by
// ScoringService (rubric mode) and PairwiseService (pairwise mode), both
// "judging" write paths held to the same rule. Mirrors
// submissions.service.ts's deadline pattern: checked on every mutating
// action, with the rejection itself logged (FR-ABUSE-04 reasoning) so an
// organizer can see a late attempt happened.
// Automatic mode (judgingOpenAt set): the timestamps are the truth. Manual
// mode (null): scoring/comparing is allowed only while status is exactly
// "judging" — the organizer-driven equivalent of the window.
export async function assertJudgingWindowOpen(
  db: Database,
  audit: AuditService,
  eventId: string,
  actorUserId: string,
  attemptedAction: string,
) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) {
    throw new NotFoundException();
  }
  if (event.judgingOpenAt === null) {
    if (event.status !== EVENT_STATUS.JUDGING) {
      await audit.log({
        eventId,
        actorUserId,
        action: AUDIT_ACTION.SCORE_WINDOW_REJECTED,
        resourceType: "event",
        resourceId: eventId,
        metadata: { attemptedAction, reason: "not_open" },
      });
      throw new ConflictException({
        error: { code: ERROR_CODE.JUDGING_NOT_OPEN, message: "Judging isn't open right now" },
      });
    }
    return;
  }
  const now = new Date();
  if (now < event.judgingOpenAt || now > event.judgingCloseAt!) {
    await audit.log({
      eventId,
      actorUserId,
      action: AUDIT_ACTION.SCORE_WINDOW_REJECTED,
      resourceType: "event",
      resourceId: eventId,
      metadata: { attemptedAction, reason: now < event.judgingOpenAt ? "not_open" : "closed" },
    });
    throw new ConflictException({
      error: {
        code: now < event.judgingOpenAt ? "JUDGING_NOT_OPEN" : "JUDGING_WINDOW_CLOSED",
        message:
          now < event.judgingOpenAt
            ? "Judging hasn't opened yet for this event"
            : "The judging window for this event has closed",
      },
    });
  }
}
