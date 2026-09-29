import {
  AUDIT_ACTION,
  ERROR_CODE,
  type EventRole,
  type EventRoleListEntry,
  type MyEventInvite,
} from "@hackpulse/shared";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, ilike, inArray } from "drizzle-orm";

import { AuditService } from "../../audit/audit.service";
import type { Database } from "../../db/client";
import {
  eventInvites,
  eventRoles,
  events,
  judgeTrackScopes,
  teamMembers,
  teams,
  tracks,
  user,
} from "../../db/schema";
import { DB } from "../../db/tokens";
import { JudgeTrackScopeService } from "../judge-track-scope.service";

// Shared by judge invites and co-organizer invites: same pending →
// accept/decline state machine either way. JudgesService delegates here
// with role="judge" fixed; OrganizersController uses role="organizer"
// directly. Callers own authorization for who can invite
// (@Roles(EVENT_ROLE.ORGANIZER)); identity checks happen here since the invitee
// isn't a role-holder yet.
@Injectable()
export class EventRoleInvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly judgeTrackScope: JudgeTrackScopeService,
  ) {}

  async invite(
    eventId: string,
    invitedByUserId: string,
    role: EventRole,
    email: string,
    trackIds: string[],
  ) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const [invitee] = await this.db.select().from(user).where(ilike(user.email, email));
    if (!invitee) {
      throw new NotFoundException({
        error: {
          code: ERROR_CODE.NOT_FOUND,
          message: "No account with that email yet. They need to register before being invited",
        },
      });
    }

    if (role === "judge" && trackIds.length > 0) {
      const validTracks = await this.db
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.eventId, eventId), inArray(tracks.id, trackIds)));
      if (validTracks.length !== trackIds.length) {
        throw new NotFoundException({
          error: {
            code: ERROR_CODE.VALIDATION_ERROR,
            message: "One or more trackIds don't belong to this event",
          },
        });
      }
    }

    const [existingRole] = await this.db
      .select()
      .from(eventRoles)
      .where(
        and(
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.userId, invitee.id),
          eq(eventRoles.role, role),
        ),
      );
    if (existingRole) {
      // Already holds this role on this event, nothing left to consent
      // to. For a judge this adds the newly-requested tracks directly; for
      // an organizer (trackIds always empty) it's a harmless no-op instead
      // of an error.
      await this.judgeTrackScope.addTrackScopes(existingRole.id, trackIds);
      return { status: "accepted" as const, userId: invitee.id, eventRoleId: existingRole.id };
    }

    const [existingInvite] = await this.db
      .select()
      .from(eventInvites)
      .where(
        and(
          eq(eventInvites.eventId, eventId),
          eq(eventInvites.inviteeUserId, invitee.id),
          eq(eventInvites.role, role),
        ),
      );
    if (existingInvite) {
      const [updated] = await this.db
        .update(eventInvites)
        .set({ trackIds, status: "pending", respondedAt: null, invitedByUserId })
        .where(eq(eventInvites.id, existingInvite.id))
        .returning();
      return { status: "pending" as const, inviteId: updated.id, userId: invitee.id };
    }

    const [created] = await this.db
      .insert(eventInvites)
      .values({ eventId, inviteeUserId: invitee.id, invitedByUserId, role, trackIds })
      .returning();
    return { status: "pending" as const, inviteId: created.id, userId: invitee.id };
  }

  private async loadInviteForResponse(eventId: string, inviteId: string, currentUserId: string) {
    const [invite] = await this.db
      .select()
      .from(eventInvites)
      .where(and(eq(eventInvites.id, inviteId), eq(eventInvites.eventId, eventId)));
    if (!invite) {
      throw new NotFoundException();
    }
    if (invite.inviteeUserId !== currentUserId) {
      throw new ForbiddenException();
    }
    if (invite.status !== "pending") {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.ALREADY_RESOLVED,
          message: "This invite has already been responded to.",
        },
      });
    }
    return invite;
  }

  async accept(eventId: string, inviteId: string, currentUserId: string) {
    const invite = await this.loadInviteForResponse(eventId, inviteId, currentUserId);

    // Mirrors TeamsService's block on the other direction (an
    // organizer/judge can't create or join a team on their event): a
    // participant can't accept their way into organizing or judging the
    // same event either.
    const [existingMembership] = await this.db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, currentUserId)));
    if (existingMembership) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.CONFLICT,
          message:
            "You're already participating in this event, so you can't also organize or judge it",
        },
      });
    }

    return this.db
      .transaction(async (tx) => {
        let [role] = await tx
          .select()
          .from(eventRoles)
          .where(
            and(
              eq(eventRoles.eventId, eventId),
              eq(eventRoles.userId, currentUserId),
              eq(eventRoles.role, invite.role),
            ),
          );
        if (!role) {
          [role] = await tx
            .insert(eventRoles)
            .values({ eventId, userId: currentUserId, role: invite.role })
            .returning();
        }
        for (const trackId of invite.trackIds) {
          const [existing] = await tx
            .select()
            .from(judgeTrackScopes)
            .where(
              and(eq(judgeTrackScopes.eventRoleId, role.id), eq(judgeTrackScopes.trackId, trackId)),
            );
          if (!existing) {
            await tx.insert(judgeTrackScopes).values({ eventRoleId: role.id, trackId });
          }
        }
        await tx
          .update(eventInvites)
          .set({ status: "accepted", respondedAt: new Date() })
          .where(eq(eventInvites.id, inviteId));

        return { eventRoleId: role.id };
      })
      .then(async (result) => {
        // FR-ABUSE-05 "role change" — logged after the transaction commits,
        // never before; a logged action must have actually happened. Shared
        // action name across both roles this service grants (judge,
        // co-organizer) since it's the same consent-then-grant machinery.
        await this.audit.log({
          eventId,
          actorUserId: currentUserId,
          action: AUDIT_ACTION.EVENT_ROLE_GRANTED,
          resourceType: "event_role",
          resourceId: result.eventRoleId,
          metadata: { role: invite.role },
        });
        return result;
      });
  }

  async decline(eventId: string, inviteId: string, currentUserId: string): Promise<void> {
    await this.loadInviteForResponse(eventId, inviteId, currentUserId);
    await this.db
      .update(eventInvites)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(eventInvites.id, inviteId));
  }

  // Every pending invite addressed to this user, across every event and
  // both roles — what the notifications bell polls.
  async myPending(userId: string): Promise<MyEventInvite[]> {
    const invites = await this.db
      .select({
        id: eventInvites.id,
        eventId: eventInvites.eventId,
        eventName: events.name,
        role: eventInvites.role,
        trackIds: eventInvites.trackIds,
        invitedByUserId: eventInvites.invitedByUserId,
      })
      .from(eventInvites)
      .innerJoin(events, eq(events.id, eventInvites.eventId))
      .where(and(eq(eventInvites.inviteeUserId, userId), eq(eventInvites.status, "pending")));

    return Promise.all(
      invites.map(async (inv) => {
        const [inviter] = await this.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, inv.invitedByUserId));
        const trackRows =
          inv.trackIds.length > 0
            ? await this.db
                .select({ name: tracks.name })
                .from(tracks)
                .where(inArray(tracks.id, inv.trackIds))
            : [];
        return {
          id: inv.id,
          eventId: inv.eventId,
          eventName: inv.eventName,
          role: inv.role,
          trackNames: trackRows.map((t) => t.name),
          invitedByName: inviter?.name ?? "An organizer",
        };
      }),
    );
  }

  // Accepted role-holders (whether via invite acceptance, or a direct
  // eventRoles grant that predates invites — e.g. the event creator's own
  // organizer row, or seed data) plus unresolved and declined invites for
  // this role, so a dashboard list can show who hasn't responded instead
  // of only ever listing already-active holders. The two groups never
  // overlap: invite() only ever creates a pending row for someone who does
  // *not* already hold this exact role on this event.
  async listForEvent(eventId: string, role: EventRole): Promise<EventRoleListEntry[]> {
    const roles = await this.db
      .select({ eventRoleId: eventRoles.id, userId: user.id, name: user.name, email: user.email })
      .from(eventRoles)
      .innerJoin(user, eq(user.id, eventRoles.userId))
      .where(and(eq(eventRoles.eventId, eventId), eq(eventRoles.role, role)));

    const accepted: EventRoleListEntry[] = await Promise.all(
      roles.map(async (r) => {
        const scopedTracks = await this.db
          .select({ id: tracks.id, name: tracks.name })
          .from(judgeTrackScopes)
          .innerJoin(tracks, eq(tracks.id, judgeTrackScopes.trackId))
          .where(eq(judgeTrackScopes.eventRoleId, r.eventRoleId));
        return {
          id: r.eventRoleId,
          inviteId: null,
          userId: r.userId,
          name: r.name,
          email: r.email,
          role,
          status: "accepted" as const,
          tracks: scopedTracks,
        };
      }),
    );

    const invites = await this.db
      .select({
        id: eventInvites.id,
        userId: user.id,
        name: user.name,
        email: user.email,
        status: eventInvites.status,
        trackIds: eventInvites.trackIds,
      })
      .from(eventInvites)
      .innerJoin(user, eq(user.id, eventInvites.inviteeUserId))
      .where(
        and(
          eq(eventInvites.eventId, eventId),
          eq(eventInvites.role, role),
          inArray(eventInvites.status, ["pending", "declined"]),
        ),
      );

    const pendingOrDeclined: EventRoleListEntry[] = await Promise.all(
      invites.map(async (inv) => {
        const trackRows =
          inv.trackIds.length > 0
            ? await this.db
                .select({ id: tracks.id, name: tracks.name })
                .from(tracks)
                .where(inArray(tracks.id, inv.trackIds))
            : [];
        return {
          id: inv.id,
          inviteId: inv.id,
          userId: inv.userId,
          name: inv.name,
          email: inv.email,
          role,
          status: inv.status as "pending" | "declined",
          tracks: trackRows,
        };
      }),
    );

    return [...accepted, ...pendingOrDeclined];
  }
}
