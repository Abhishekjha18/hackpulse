import type { EventRoleListEntry, InviteJudgeInput, SelfJudgeInput } from "@hackpulse/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { EventRoleInvitesService } from "../common/event-roles/event-role-invites.service";
import { JudgeTrackScopeService } from "../common/judge-track-scope.service";
import type { Database } from "../db/client";
import { eventRoles, judgeAssignments, tracks } from "../db/schema";
import { DB } from "../db/tokens";

@Injectable()
export class JudgesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly invites: EventRoleInvitesService,
    private readonly audit: AuditService,
    private readonly judgeTrackScope: JudgeTrackScopeService,
  ) {}

  // FR-JASSIGN-01: no email provider (NFR-OPS-01), so this can't send
  // mail either; the judge finds out via the notifications bell instead.
  // Delegates to EventRoleInvitesService (role="judge" fixed), the same
  // pending-invite state machine co-organizer invites use.
  invite(eventId: string, invitedByUserId: string, input: InviteJudgeInput) {
    return this.invites.invite(eventId, invitedByUserId, "judge", input.email, input.trackIds);
  }

  acceptInvite(eventId: string, inviteId: string, currentUserId: string) {
    return this.invites.accept(eventId, inviteId, currentUserId);
  }

  declineInvite(eventId: string, inviteId: string, currentUserId: string): Promise<void> {
    return this.invites.decline(eventId, inviteId, currentUserId);
  }

  listForEvent(eventId: string): Promise<EventRoleListEntry[]> {
    return this.invites.listForEvent(eventId, "judge");
  }

  // The organizer judging their own event: clicking this on their own
  // dashboard already is consent, so unlike invite() this grants the role
  // directly, no pending state, no invite row. @Roles("organizer") in the
  // controller proves it's actually them and actually their event.
  async selfJudge(eventId: string, organizerUserId: string, input: SelfJudgeInput) {
    const validTracks = await this.db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.eventId, eventId), inArray(tracks.id, input.trackIds)));
    if (validTracks.length !== input.trackIds.length) {
      throw new BadRequestException({
        error: {
          code: "VALIDATION_ERROR",
          message: "One or more trackIds don't belong to this event",
        },
      });
    }

    let [role] = await this.db
      .select()
      .from(eventRoles)
      .where(
        and(
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.userId, organizerUserId),
          eq(eventRoles.role, "judge"),
        ),
      );
    let isNewGrant = false;
    if (!role) {
      [role] = await this.db
        .insert(eventRoles)
        .values({ eventId, userId: organizerUserId, role: "judge" })
        .returning();
      isNewGrant = true;
    }
    await this.judgeTrackScope.addTrackScopes(role.id, input.trackIds);

    if (isNewGrant) {
      // FR-ABUSE-05 "role change": logged only for the actual grant, not
      // every subsequent call that just adds more tracks to an existing
      // self-judge role.
      await this.audit.log({
        eventId,
        actorUserId: organizerUserId,
        action: "event_role.granted",
        resourceType: "event_role",
        resourceId: role.id,
        metadata: { role: "judge", self: true },
      });
    }
    return { eventRoleId: role.id };
  }

  // Deletes the eventRole (cascades judgeTrackScopes) and this judge's
  // assignments for the event: judgeAssignments.judgeUserId points at
  // user.id, not eventRoles, so it wouldn't otherwise be cleaned up.
  // Cascades scores/criterionScores/scoreRevisions for those assignments;
  // the frontend confirms with the organizer before calling this.
  async remove(eventId: string, eventRoleId: string, removedByUserId: string) {
    const [role] = await this.db
      .select()
      .from(eventRoles)
      .where(
        and(
          eq(eventRoles.id, eventRoleId),
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.role, "judge"),
        ),
      );
    if (!role) {
      throw new NotFoundException();
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(judgeAssignments)
        .where(
          and(eq(judgeAssignments.eventId, eventId), eq(judgeAssignments.judgeUserId, role.userId)),
        );
      await tx.delete(eventRoles).where(eq(eventRoles.id, eventRoleId));
    });

    // FR-ABUSE-05 "role change": actor is the organizer who removed them,
    // not the judge themselves (unlike the grant side, this isn't
    // self-consented).
    await this.audit.log({
      eventId,
      actorUserId: removedByUserId,
      action: "event_role.revoked",
      resourceType: "event_role",
      resourceId: eventRoleId,
      metadata: { role: "judge", targetUserId: role.userId },
    });
  }
}
