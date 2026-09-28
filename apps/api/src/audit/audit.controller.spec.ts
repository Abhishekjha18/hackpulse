import type { CurrentUser } from "@hackpulse/shared";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

import type { Database } from "../db/client";
import { AuditController, AuditGlobalController } from "./audit.controller";
import type { AuditService } from "./audit.service";

const REAL_EVENT_ID = "11111111-1111-1111-1111-111111111111";
const NONEXISTENT_EVENT_ID = "22222222-2222-2222-2222-222222222222";

function organizer(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: "organizer-1",
    email: "organizer-1@example.com",
    name: "Organizer",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: true,
    eventRoles: [{ eventId: REAL_EVENT_ID, role: "organizer" }],
    ...overrides,
  };
}

// AuditController now checks the event exists before deciding permission
// (see the ledgered fix for the code-review finding: an unauthorized
// request for a nonexistent/malformed eventId used to reach
// AuditService.log() and fail the eventId foreign key, turning a 403 into
// an unhandled 500 and leaking whether an event id exists via status code).
// Same mocking convention as the other guard specs in this directory: the
// mock returns canned data regardless of the query's actual WHERE value —
// each test picks whichever outcome (event found / not found) it needs.
function makeDb(eventFound: boolean) {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(eventFound ? [{ id: REAL_EVENT_ID }] : []),
      }),
    }),
  } as unknown as Database;
}

describe("AuditController.list", () => {
  it("404s a malformed eventId before ever touching the audit log", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(makeDb(true), audit);
    const stranger = organizer({ id: "stranger-1", eventRoles: [] });

    await expect(
      controller.list("not-a-uuid", undefined, undefined, undefined, undefined, stranger),
    ).rejects.toThrow(NotFoundException);
    expect(auditLog).not.toHaveBeenCalled();
    expect(audit.list).not.toHaveBeenCalled();
  });

  it("404s a well-formed but nonexistent eventId before ever touching the audit log", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(makeDb(false), audit);
    const stranger = organizer({ id: "stranger-1", eventRoles: [] });

    await expect(
      controller.list(NONEXISTENT_EVENT_ID, undefined, undefined, undefined, undefined, stranger),
    ).rejects.toThrow(NotFoundException);
    expect(auditLog).not.toHaveBeenCalled();
    expect(audit.list).not.toHaveBeenCalled();
  });

  it("404s a nonexistent eventId even for an admin caller, before any list/log call", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(makeDb(false), audit);
    const admin = organizer({ id: "admin-1", isAdmin: true, eventRoles: [] });

    await expect(
      controller.list(NONEXISTENT_EVENT_ID, undefined, undefined, undefined, undefined, admin),
    ).rejects.toThrow(NotFoundException);
    expect(auditLog).not.toHaveBeenCalled();
    expect(audit.list).not.toHaveBeenCalled();
  });

  it("logs audit_log.access_denied and throws for a non-organizer, non-admin caller on a real event", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(makeDb(true), audit);
    const stranger = organizer({ id: "stranger-1", eventRoles: [] });

    await expect(
      controller.list(REAL_EVENT_ID, undefined, undefined, undefined, undefined, stranger),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith({
      eventId: REAL_EVENT_ID,
      actorUserId: "stranger-1",
      action: "audit_log.access_denied",
      resourceType: "event",
      resourceId: REAL_EVENT_ID,
    });
    expect(audit.list).not.toHaveBeenCalled();
  });

  it("does not log when the caller is the event's organizer", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = {
      log: auditLog,
      list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as AuditService;
    const controller = new AuditController(makeDb(true), audit);

    await controller.list(REAL_EVENT_ID, undefined, undefined, undefined, undefined, organizer());
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe("AuditGlobalController.list", () => {
  it("logs audit_log.access_denied to the GLOBAL partition for a non-admin caller", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditGlobalController(audit);

    await expect(
      controller.list(undefined, undefined, undefined, undefined, organizer()),
    ).rejects.toThrow(ForbiddenException);
    expect(auditLog).toHaveBeenCalledWith({
      eventId: null,
      actorUserId: "organizer-1",
      action: "audit_log.access_denied",
      resourceType: "instance",
      resourceId: "GLOBAL",
    });
  });
});
