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
