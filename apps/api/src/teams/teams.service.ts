import {
  type CreateTeamInput,
  type CurrentUser,
  ERROR_CODE,
  EVENT_ROLE,
  EVENT_STATUS,
} from "@hackpulse/shared";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";

import { isEventOrganizer } from "../common/auth/is-event-organizer";
import type { Database } from "../db/client";
import { events, teamMembers, teams, user } from "../db/schema";
import { DB } from "../db/tokens";
import { computeDisplayStatus } from "../events/events.service";
import { generateInviteCode } from "./invite-code";

@Injectable()
export class TeamsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // FR-EVT-01: "registering" for this event means creating or joining a
  // team (there's no separate signup step), so this is where the window
  // belongs. Server clock only, never the client's.
  // Automatic mode (registrationOpenAt set): the timestamp is the truth.
  // Manual mode (null): the organizer-driven status is, since there's no
  // clock to check against — team formation is allowed only while status
  // is exactly "registration_open", the manual equivalent of the window.
  private assertRegistrationOpen(event: typeof events.$inferSelect) {
    if (event.registrationOpenAt === null) {
      if (event.status !== EVENT_STATUS.REGISTRATION_OPEN) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.REGISTRATION_NOT_OPEN,
            message: "Registration isn't open right now",
          },
        });
      }
      return;
    }
    const now = new Date();
    if (now < event.registrationOpenAt) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.REGISTRATION_NOT_OPEN,
          message: "Registration hasn't opened yet",
        },
      });
    }
    if (now > event.registrationCloseAt!) {
      throw new ConflictException({
        error: { code: ERROR_CODE.REGISTRATION_CLOSED, message: "Registration has closed" },
      });
    }
  }

  // Organizing/judging and participating in the same event are mutually
  // exclusive: the most severe conflict of interest, structural rather
  // than declared. Checked against currentUser.eventRoles, computed fresh
  // per-request server-side, so no extra query needed here.
  private assertNotOrganizerOrJudge(currentUser: CurrentUser, eventId: string): void {
    if (
      currentUser.eventRoles.some(
        (r) =>
          r.eventId === eventId && (r.role === EVENT_ROLE.ORGANIZER || r.role === EVENT_ROLE.JUDGE),
      )
    ) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.CONFLICT,
          message: "You organize or judge this event, so you can't also participate in it",
        },
      });
    }
  }

  // findMine (below) assumes at most one team per event; without this
  // check, joining a second team would silently hide the first
  // membership. CSV registration import has the same check.
  private async assertNotAlreadyOnATeam(eventId: string, userId: string): Promise<void> {
    const [existing] = await this.db
      .select({ teamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, userId)));
    if (existing) {
      throw new ConflictException({
        error: {
          code: ERROR_CODE.CONFLICT,
          message: `Already on team "${existing.teamName}" for this event`,
        },
      });
    }
  }

  // FR-TEAM-01 — creator becomes the team's first member and owner.
  async create(eventId: string, input: CreateTeamInput, currentUser: CurrentUser) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    this.assertRegistrationOpen(event);
    this.assertNotOrganizerOrJudge(currentUser, eventId);
    await this.assertNotAlreadyOnATeam(eventId, currentUser.id);

    return this.db.transaction(async (tx) => {
      const [team] = await tx
        .insert(teams)
        .values({
          eventId,
          name: input.name,
          ownerUserId: currentUser.id,
          inviteCode: generateInviteCode(),
        })
        .returning();

      await tx.insert(teamMembers).values({ teamId: team.id, userId: currentUser.id });

      return team;
    });
  }

  // Joined to the user table for a display name, not just the bare userId.
  // A teammate's name isn't sensitive like an email: every member of a
  // team already knows who's on it.
  private async getMembers(teamId: string) {
    return this.db
      .select({
        id: teamMembers.id,
        teamId: teamMembers.teamId,
        userId: teamMembers.userId,
        joinedAt: teamMembers.joinedAt,
        userName: user.name,
      })
      .from(teamMembers)
      .innerJoin(user, eq(user.id, teamMembers.userId))
      .where(eq(teamMembers.teamId, teamId));
  }

  // Backs the web UI's "my team" view: a participant returning to the
  // event has no other way to find their team's id.
  async findMine(eventId: string, userId: string) {
    const [row] = await this.db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, userId)));

    if (!row) {
      return null;
    }
    const members = await this.getMembers(row.team.id);
    return { ...row.team, members };
  }

  // Backs the nav's "My teams" link, for finding a team on an event the
  // user isn't currently viewing.
  async findAllMine(userId: string) {
    const rows = await this.db
      .select({
        teamId: teams.id,
        teamName: teams.name,
        eventId: events.id,
        eventName: events.name,
        eventStatus: events.status,
        registrationOpenAt: events.registrationOpenAt,
        submissionOpenAt: events.submissionOpenAt,
        judgingOpenAt: events.judgingOpenAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(events, eq(events.id, teams.eventId))
      .where(eq(teamMembers.userId, userId));

    return rows.map(({ registrationOpenAt, submissionOpenAt, judgingOpenAt, ...r }) => ({
      ...r,
      eventDisplayStatus: computeDisplayStatus({
        status: r.eventStatus,
        registrationOpenAt,
        submissionOpenAt,
        judgingOpenAt,
      }),
    }));
  }

  async findOne(teamId: string, currentUser: CurrentUser | null) {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) {
      throw new NotFoundException();
    }

    const members = await this.getMembers(teamId);
    const isMember = currentUser && members.some((m) => m.userId === currentUser.id);

    if (!isMember && !isEventOrganizer(currentUser, team.eventId)) {
      // A team a caller has no standing to see returns 404, matching the
      // same "don't leak existence" posture as event visibility.
      throw new NotFoundException();
    }

    return { ...team, members };
  }

  // Organizer-only roster view, backs the certificate recipient picker.
  async listForEvent(eventId: string) {
    const eventTeams = await this.db.select().from(teams).where(eq(teams.eventId, eventId));
    return Promise.all(
      eventTeams.map(async (t) => ({ ...t, members: await this.getMembers(t.id) })),
    );
  }

  // FR-TEAM-02 — subject to the event's configured max team size.
  async join(inviteCode: string, currentUser: CurrentUser) {
    const [team] = await this.db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
    if (!team) {
      throw new NotFoundException();
    }

    const [event] = await this.db.select().from(events).where(eq(events.id, team.eventId));
    if (!event) {
      throw new NotFoundException();
    }
    this.assertNotOrganizerOrJudge(currentUser, team.eventId);

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, currentUser.id)));
      if (existing) {
        return team;
      }

      // Not a rejoin — check for membership on a *different* team for this
      // event before allowing a new one. tx-scoped, unlike
      // assertNotAlreadyOnATeam (used by create(), which runs before any
      // transaction starts) — this check and the insert below need to be
      // atomic with each other, the same as the rejoin check just above.
      const [otherTeam] = await tx
        .select({ teamName: teams.name })
        .from(teamMembers)
        .innerJoin(teams, eq(teams.id, teamMembers.teamId))
        .where(and(eq(teams.eventId, team.eventId), eq(teamMembers.userId, currentUser.id)));
      if (otherTeam) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.CONFLICT,
            message: `Already on team "${otherTeam.teamName}" for this event`,
          },
        });
      }

      // Rejoining an existing membership is always allowed above (it's a
      // no-op, not a new registration) — the window only gates actually
      // becoming a new member.
      this.assertRegistrationOpen(event);

      const [{ value: memberCount }] = await tx
        .select({ value: count() })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, team.id));

      if (memberCount >= event.maxTeamSize) {
        throw new ConflictException({
          error: {
            code: ERROR_CODE.CONFLICT,
            message: `Team is at its ${event.maxTeamSize}-member limit`,
          },
        });
      }

      await tx.insert(teamMembers).values({ teamId: team.id, userId: currentUser.id });
      return team;
    });
  }

  // FR-TEAM-05 — invalidates the old code by replacing it.
  async regenerateInvite(teamId: string, currentUser: CurrentUser) {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) {
      throw new NotFoundException();
    }

    if (team.ownerUserId !== currentUser.id && !isEventOrganizer(currentUser, team.eventId)) {
      throw new ForbiddenException();
    }

    const [updated] = await this.db
      .update(teams)
      .set({ inviteCode: generateInviteCode(), inviteCodeRegeneratedAt: new Date() })
      .where(eq(teams.id, teamId))
      .returning();

    return updated;
  }

  // FR-TEAM-04 — the owner (or an organizer/admin) can remove any member;
  // a non-owner member can also remove themselves (leave). The owner
  // cannot be removed this way, including by themselves — ownership
  // transfer/team deletion is a separate, not-yet-built concern, so
  // leaving would strand the team without an owner.
  async removeMember(teamId: string, targetUserId: string, currentUser: CurrentUser) {
    const [team] = await this.db.select().from(teams).where(eq(teams.id, teamId));
    if (!team) {
      throw new NotFoundException();
    }

    const isSelf = targetUserId === currentUser.id;
    if (
      !isSelf &&
      team.ownerUserId !== currentUser.id &&
      !isEventOrganizer(currentUser, team.eventId)
    ) {
      throw new ForbiddenException();
    }

    if (targetUserId === team.ownerUserId) {
      throw new ConflictException({
        error: { code: ERROR_CODE.CONFLICT, message: "The team owner cannot be removed" },
      });
    }

    await this.db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));
  }
}
