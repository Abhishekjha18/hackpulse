import type { CurrentUser } from "@hackpulse/shared";
import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";

import type { AuditService } from "../../audit/audit.service";
import type { JudgeTrackScopeService } from "../../common/judge-track-scope.service";
import { TrackScopeGuard } from "./track-scope.guard";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const TRACK_A = "22222222-2222-2222-2222-222222222222";
const TRACK_B = "33333333-3333-3333-3333-333333333333";

function makeJudgeTrackScope(scopedTrackIds: string[]) {
  return {
    isScoped: jest.fn((_eventId: string, _judgeUserId: string, trackId: string) =>
      Promise.resolve(scopedTrackIds.includes(trackId)),
    ),
  } as unknown as JudgeTrackScopeService;
}

function makeAudit(): { log: jest.Mock } & AuditService {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as {
    log: jest.Mock;
  } & AuditService;
}

function makeContext(
  user: CurrentUser | null,
  trackSource: { params?: string; query?: string; body?: string } = {},
): ExecutionContext {
  const request = {
    user,
    params: { eventId: EVENT_A, ...(trackSource.params ? { trackId: trackSource.params } : {}) },
    query: trackSource.query ? { trackId: trackSource.query } : {},
    body: trackSource.body ? { trackId: trackSource.body } : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function judge(id: string): CurrentUser {
  return {
    id,
    email: `${id}@example.com`,
    name: "Judge",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: false,
    eventRoles: [{ eventId: EVENT_A, role: "judge" }],
  };
}

describe("TrackScopeGuard", () => {
  it("denies an unauthenticated caller", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(null, { query: TRACK_A }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("denies when no trackId is present anywhere on the request", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("denies a judge not scoped to the requested track: the core isolation property", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { query: TRACK_B })),
    ).rejects.toThrow(ForbiddenException);
  });

  it("logs a track_scope.access_denied entry when a judge is out of scope for the track", async () => {
    const audit = makeAudit();
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), audit);
    await expect(
      guard.canActivate(makeContext(judge("judge-b"), { query: TRACK_B })),
    ).rejects.toThrow(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorUserId: "judge-b",
      action: "track_scope.access_denied",
      resourceType: "track",
      resourceId: TRACK_B,
    });
  });

  it("does not log anything when no trackId is present on the request", async () => {
    const audit = makeAudit();
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), audit);
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("allows a judge scoped to the requested track", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { query: TRACK_A })),
    ).resolves.toBe(true);
  });

  it("resolves trackId from a route param when present", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(
      guard.canActivate(makeContext(judge("judge-a"), { params: TRACK_A })),
    ).resolves.toBe(true);
  });

  it("resolves trackId from the request body when not in params or query", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([TRACK_A]), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a"), { body: TRACK_A }))).resolves.toBe(
      true,
    );
  });

  it("allows the event's organizer regardless of judge_track_scopes", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([]), makeAudit()); // not scoped to anything
    const organizer: CurrentUser = {
      ...judge("org-a"),
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(organizer, { query: TRACK_A }))).resolves.toBe(true);
  });

  // Same posture as AssignmentOwnershipGuard: isAdmin alone is not an
  // automatic bypass, only an actual organizer role on *this* event is.
  it("denies a global admin who is neither scoped nor this event's organizer", async () => {
    const guard = new TrackScopeGuard(makeJudgeTrackScope([]), makeAudit());
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin, { query: TRACK_A }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
