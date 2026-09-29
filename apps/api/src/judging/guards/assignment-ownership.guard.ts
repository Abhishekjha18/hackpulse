import { AUDIT_ACTION, type CurrentUser } from "@hackpulse/shared";
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
        action: AUDIT_ACTION.SCORE_ACCESS_DENIED,
        resourceType: "judge_assignment",
        resourceId: assignmentId,
        metadata: { submissionId: assignment.submissionId },
      });
      throw new ForbiddenException();
    }

    return true;
  }
}
