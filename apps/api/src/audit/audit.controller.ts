import { AUDIT_ACTION, type CurrentUser as CurrentUserType } from "@hackpulse/shared";
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { eq } from "drizzle-orm";

import { CurrentUser } from "../auth/current-user.decorator";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import { Public } from "../common/decorators/public.decorator";
import type { Database } from "../db/client";
import { events } from "../db/schema";
import { DB } from "../db/tokens";
import { AuditService } from "./audit.service";

// A malformed id fails a uuid column comparison in Postgres before any
// WHERE clause even runs — checked here first so that case 404s the same
// way a well-formed-but-nonexistent id does, rather than surfacing as a
// raw driver error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("events/:eventId/audit-log")
export class AuditController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // Deliberately not @Roles("organizer"): admin gets a read-only bypass
  // here, the oversight capability needed to investigate a dispute without
  // full organizer control over someone else's event.
  // FR-ROLE-06: the 403 below is a deny decision on a sensitive resource
  // (the audit log itself) and must be auditable, same as any other.
  //
  // Found in code review: this used to skip straight to the
  // organizer/admin check, so a stranger requesting a nonexistent or
  // malformed eventId reached AuditService.log() with a bad eventId,
  // which fails the column's foreign-key/uuid constraint and surfaces as
  // an unhandled 500 — a regression from the pre-existing 403, and one
  // that let a caller tell "exists" from "doesn't exist" by status code.
  // The existence check below runs before the permission check, matching
  // AssignmentOwnershipGuard's own established convention: 404 for a
  // genuinely nonexistent resource, 403 only once it's confirmed to exist.
  @Get()
  async list(
    @Param("eventId") eventId: string,
    @Query("since") since: string | undefined,
    @Query("action") action: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!UUID_RE.test(eventId)) {
      throw new NotFoundException();
    }
    const [event] = await this.db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    if (!isEventOrganizer(user, eventId) && !user.isAdmin) {
      await this.audit.log({
        eventId,
        actorUserId: user.id,
        action: AUDIT_ACTION.AUDIT_LOG_ACCESS_DENIED,
        resourceType: "event",
        resourceId: eventId,
      });
      throw new ForbiddenException();
    }
    return this.audit.list(eventId, {
      since: since ? new Date(since) : undefined,
      action,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Public by design (matches GET /verify/judge-record/:id): a hash-chain
  // audit log's whole point is independent verification, without trusting
  // the server's say-so, and an organizer-only gate would let a tampering
  // organizer just never run the check. The response carries no row
  // content or actor PII, only valid/brokenAt/reason.
  @Get("verify")
  @Public()
  verify(@Param("eventId") eventId: string) {
    return this.audit.verifyChain(eventId);
  }
}

// The GLOBAL partition (auth, admin capability grants) is admin-only,
// not the organizer-or-admin posture the per-event routes above use: no
// per-event organizer has a claim to see instance-wide auth events.
// Separate controller since AuditController's route is fixed to
// events/:eventId/... and "global" isn't an eventId.
@Controller("audit-log/global")
export class AuditGlobalController {
  constructor(private readonly audit: AuditService) {}

  // FR-ROLE-06: same reasoning as AuditController.list above, logged to
  // the GLOBAL partition (eventId: null) since there's no event to scope it to.
  @Get()
  async list(
    @Query("since") since: string | undefined,
    @Query("action") action: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limit: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!user.isAdmin) {
      await this.audit.log({
        eventId: null,
        actorUserId: user.id,
        action: AUDIT_ACTION.AUDIT_LOG_ACCESS_DENIED,
        resourceType: "instance",
        resourceId: "GLOBAL",
      });
      throw new ForbiddenException();
    }
    return this.audit.list(null, {
      since: since ? new Date(since) : undefined,
      action,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // Not @Public() like the per-event verify: entriesChecked reveals
  // instance-wide activity, not any one organizer's event.
  @Get("verify")
  async verify(@CurrentUser() user: CurrentUserType) {
    if (!user.isAdmin) {
      await this.audit.log({
        eventId: null,
        actorUserId: user.id,
        action: AUDIT_ACTION.AUDIT_LOG_ACCESS_DENIED,
        resourceType: "instance",
        resourceId: "GLOBAL",
      });
      throw new ForbiddenException();
    }
    return this.audit.verifyChain(null);
  }
}
