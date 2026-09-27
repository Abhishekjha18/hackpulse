import type { CurrentUser } from "@hackpulse/shared";
import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import type { AuditService } from "../../audit/audit.service";
import type { Database } from "../../db/client";
import { AssignmentOwnershipGuard } from "./assignment-ownership.guard";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const ASSIGNMENT_ID = "22222222-2222-2222-2222-222222222222";

function makeDb(
  assignment:
    { id: string; eventId: string; judgeUserId: string; submissionId?: string } | undefined,
) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(assignment ? [assignment] : []),
      }),
    }),
  } as unknown as Database;
}

function makeAudit(): { log: jest.Mock } & AuditService {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as {
    log: jest.Mock;
  } & AuditService;
}

function makeContext(user: CurrentUser | null): ExecutionContext {
  const request = { user, params: { assignmentId: ASSIGNMENT_ID } };
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

describe("AssignmentOwnershipGuard", () => {
  it("denies an unauthenticated caller", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(null))).rejects.toThrow(UnauthorizedException);
  });

  it("404s a nonexistent assignment rather than leaking a filtered result", async () => {
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), makeAudit());
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("denies a different judge's assignment — the core isolation property", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(judge("judge-b")))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("logs a score.access_denied entry when a judge is refused another judge's assignment", async () => {
    const audit = makeAudit();
    const guard = new AssignmentOwnershipGuard(
      makeDb({
        id: ASSIGNMENT_ID,
        eventId: EVENT_A,
        judgeUserId: "judge-a",
        submissionId: "sub-1",
      }),
      audit,
    );
    await expect(guard.canActivate(makeContext(judge("judge-b")))).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit.log).toHaveBeenCalledWith({
      eventId: EVENT_A,
      actorUserId: "judge-b",
      action: "score.access_denied",
      resourceType: "judge_assignment",
      resourceId: ASSIGNMENT_ID,
      metadata: { submissionId: "sub-1" },
    });
  });

  it("does not log anything when the assignment doesn't exist", async () => {
    const audit = makeAudit();
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), audit);
    await expect(guard.canActivate(makeContext(judge("judge-a")))).rejects.toThrow(
      NotFoundException,
    );
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("allows the assigned judge", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    await expect(guard.canActivate(makeContext(judge("judge-a")))).resolves.toBe(true);
  });

  it("allows the event's organizer even though they are not the assigned judge", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const organizer: CurrentUser = {
      ...judge("org-a"),
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(organizer))).resolves.toBe(true);
  });

  // Admin bypass reversed: isAdmin alone must not skip the
  // existence/ownership check.
  it("does not let a global admin bypass a nonexistent assignment", async () => {
    const guard = new AssignmentOwnershipGuard(makeDb(undefined), makeAudit());
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin))).rejects.toThrow(NotFoundException);
  });

  it("denies a global admin who is neither the assigned judge nor that event's organizer", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const admin: CurrentUser = { ...judge("admin-a"), isAdmin: true, eventRoles: [] };
    await expect(guard.canActivate(makeContext(admin))).rejects.toThrow(ForbiddenException);
  });

  it("still allows a global admin who also organizes this event", async () => {
    const guard = new AssignmentOwnershipGuard(
      makeDb({ id: ASSIGNMENT_ID, eventId: EVENT_A, judgeUserId: "judge-a" }),
      makeAudit(),
    );
    const admin: CurrentUser = {
      ...judge("admin-a"),
      isAdmin: true,
      eventRoles: [{ eventId: EVENT_A, role: "organizer" }],
    };
    await expect(guard.canActivate(makeContext(admin))).resolves.toBe(true);
  });
});
