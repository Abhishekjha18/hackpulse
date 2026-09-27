import type { CurrentUser } from "@hackpulse/shared";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RolesGuard } from "./roles.guard";

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const EVENT_B = "22222222-2222-2222-2222-222222222222";

function makeContext(params: Record<string, string>, user: CurrentUser | null): ExecutionContext {
  const request = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function makeReflector(required: string[] | undefined): Reflector {
  return {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
}

function organizerOf(eventId: string): CurrentUser {
  return {
    id: "u1",
    email: "org@example.com",
    name: "Organizer",
    locale: "en",
    timezone: "UTC",
    isAdmin: false,
    canOrganizeEvents: false,
    eventRoles: [{ eventId, role: "organizer" }],
  };
}

describe("RolesGuard", () => {
  it("allows a route with no @Roles() decorator through unchanged", () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext({ eventId: EVENT_A }, null))).toBe(true);
  });

  it("denies an unauthenticated caller on a role-guarded route", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    expect(() => guard.canActivate(makeContext({ eventId: EVENT_A }, null))).toThrow(
      ForbiddenException,
    );
  });

  it("denies an organizer of a different event — no cross-event leakage", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    const user = organizerOf(EVENT_B);
    expect(() => guard.canActivate(makeContext({ eventId: EVENT_A }, user))).toThrow(
      ForbiddenException,
    );
  });

  it("allows an organizer of the matching event", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    const user = organizerOf(EVENT_A);
    expect(guard.canActivate(makeContext({ eventId: EVENT_A }, user))).toBe(true);
  });

  // Found live: a global admin used to bypass this unconditionally, giving
  // admins organizer-level access to every event, not just ones they
  // organize. isAdmin alone no longer satisfies an event-scoped role check.
  it("denies a global admin who doesn't hold the role on this specific event", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    const admin: CurrentUser = { ...organizerOf(EVENT_B), isAdmin: true };
    expect(() => guard.canActivate(makeContext({ eventId: EVENT_A }, admin))).toThrow(
      ForbiddenException,
    );
  });

  it("still allows a global admin who also holds the role on this event", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    const admin: CurrentUser = { ...organizerOf(EVENT_A), isAdmin: true };
    expect(guard.canActivate(makeContext({ eventId: EVENT_A }, admin))).toBe(true);
  });

  it("denies a judge role holder on a route requiring organizer", () => {
    const guard = new RolesGuard(makeReflector(["organizer"]));
    const judge: CurrentUser = {
      id: "u2",
      email: "judge@example.com",
      name: "Judge",
      locale: "en",
      timezone: "UTC",
      isAdmin: false,
      canOrganizeEvents: false,
      eventRoles: [{ eventId: EVENT_A, role: "judge" }],
    };
    expect(() => guard.canActivate(makeContext({ eventId: EVENT_A }, judge))).toThrow(
      ForbiddenException,
    );
  });
});
