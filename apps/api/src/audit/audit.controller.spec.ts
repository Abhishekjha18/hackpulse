import type { CurrentUser } from "@hackpulse/shared";
import { ForbiddenException } from "@nestjs/common";

import { AuditController, AuditGlobalController } from "./audit.controller";
import type { AuditService } from "./audit.service";

const REAL_EVENT_ID = "11111111-1111-1111-1111-111111111111";

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

describe("AuditController.list", () => {
  it("logs audit_log.access_denied and throws for a non-organizer, non-admin caller on a real event", async () => {
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const audit = { log: auditLog, list: jest.fn() } as unknown as AuditService;
    const controller = new AuditController(audit);
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
    const controller = new AuditController(audit);

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
