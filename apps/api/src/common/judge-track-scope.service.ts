import { EVENT_ROLE } from "@hackpulse/shared";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { eventRoles, judgeTrackScopes } from "../db/schema";
import { DB } from "../db/tokens";
// Shared by AssignmentsService (algorithmic assignment only ever offers a
// submission to judges scoped to its track) and PairwiseService (a judge
// can only fetch/compare pairs within a track they're scoped to). Both need
// the same "is this judge actually scoped to this track" answer — one
// place owning that join instead of two independent copies that could
// silently drift apart is worth it on its own, but it matters more here
// than in most places: this join *is* the mechanism enforcing track-level
// judge isolation (§6), not just a convenience query.
@Injectable()
export class JudgeTrackScopeService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async isScoped(eventId: string, judgeUserId: string, trackId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: judgeTrackScopes.id })
      .from(judgeTrackScopes)
      .innerJoin(eventRoles, eq(eventRoles.id, judgeTrackScopes.eventRoleId))
      .where(
        and(
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.userId, judgeUserId),
          eq(eventRoles.role, EVENT_ROLE.JUDGE),
          eq(judgeTrackScopes.trackId, trackId),
        ),
      );
    return !!row;
  }

  // Reverse of scopedJudgesForTrack: every track a given judge is scoped to
  // on this event. Backs PairwiseService.getProgressForJudge -- a judge's
  // own pending-work notification needs to know which tracks are theirs
  // without the caller supplying one up front.
  async scopedTracksForJudge(eventId: string, judgeUserId: string): Promise<string[]> {
    const rows = await this.db
      .select({ trackId: judgeTrackScopes.trackId })
      .from(judgeTrackScopes)
      .innerJoin(eventRoles, eq(eventRoles.id, judgeTrackScopes.eventRoleId))
      .where(
        and(
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.userId, judgeUserId),
          eq(eventRoles.role, EVENT_ROLE.JUDGE),
        ),
      );
    return rows.map((r) => r.trackId);
  }

  async scopedJudgesForTrack(eventId: string, trackId: string) {
    return this.db
      .select({ judgeUserId: eventRoles.userId })
      .from(judgeTrackScopes)
      .innerJoin(eventRoles, eq(eventRoles.id, judgeTrackScopes.eventRoleId))
      .where(
        and(
          eq(eventRoles.eventId, eventId),
          eq(eventRoles.role, EVENT_ROLE.JUDGE),
          eq(judgeTrackScopes.trackId, trackId),
        ),
      );
  }

  // Shared by EventRoleInvitesService.accept (an invite can list trackIds)
  // and JudgesService.selfJudge — both grant a judge scope on a set of
  // tracks and both need it idempotent (accepting doesn't fail if a scope
  // row already exists from an earlier partial grant).
  async addTrackScopes(eventRoleId: string, trackIds: string[]): Promise<void> {
    for (const trackId of trackIds) {
      const [existing] = await this.db
        .select()
        .from(judgeTrackScopes)
        .where(
          and(eq(judgeTrackScopes.eventRoleId, eventRoleId), eq(judgeTrackScopes.trackId, trackId)),
        );
      if (!existing) {
        await this.db.insert(judgeTrackScopes).values({ eventRoleId, trackId });
      }
    }
  }
}
