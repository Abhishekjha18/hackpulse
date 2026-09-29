import { ERROR_CODE } from "@hackpulse/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import {
  auditLogEntries,
  events,
  judgeAssignments,
  normalizedResults,
  pairwiseRankings,
  rubrics,
  scores,
  submissions,
  teamMembers,
  teams,
  tracks,
  user,
  votes,
} from "../db/schema";
import { DB } from "../db/tokens";
export const EXPORTABLE_RESOURCES = [
  "registrations",
  "teams",
  "submissions",
  "assignments",
  "scores",
  "normalized-results",
  "pairwise-rankings",
  "votes",
  "audit-log",
] as const;
export type ExportableResource = (typeof EXPORTABLE_RESOURCES)[number];

@Injectable()
export class ExportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // FR-EXP-01/02 — one row shape per resource, joined for human
  // readability (an email, not a bare user id); every export is scoped to
  // exactly what the caller (organizer/admin, per the controller's
  // @Roles) is already authorized to see via the API — nothing here reads
  // more broadly than an equivalent set of GET calls would.
  async export(eventId: string, resource: ExportableResource) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    switch (resource) {
      case "registrations":
        return this.db
          .select({
            teamId: teamMembers.teamId,
            teamName: teams.name,
            userEmail: user.email,
            userName: user.name,
            joinedAt: teamMembers.joinedAt,
          })
          .from(teamMembers)
          .innerJoin(teams, eq(teams.id, teamMembers.teamId))
          .innerJoin(user, eq(user.id, teamMembers.userId))
          .where(eq(teams.eventId, eventId));

      case "teams":
        return this.db
          .select({
            teamId: teams.id,
            name: teams.name,
            ownerEmail: user.email,
            inviteCode: teams.inviteCode,
            createdAt: teams.createdAt,
          })
          .from(teams)
          .innerJoin(user, eq(user.id, teams.ownerUserId))
          .where(eq(teams.eventId, eventId));

      case "submissions":
        return this.db
          .select({
            submissionId: submissions.id,
            teamName: teams.name,
            name: submissions.name,
            tagline: submissions.tagline,
            trackId: submissions.trackId,
            status: submissions.status,
            submittedAt: submissions.submittedAt,
            repoUrl: submissions.repoUrl,
            liveUrl: submissions.liveUrl,
          })
          .from(submissions)
          .innerJoin(teams, eq(teams.id, submissions.teamId))
          .where(eq(teams.eventId, eventId));

      case "assignments":
        return this.db
          .select({
            assignmentId: judgeAssignments.id,
            judgeEmail: user.email,
            submissionName: submissions.name,
            status: judgeAssignments.status,
            assignedAt: judgeAssignments.assignedAt,
          })
          .from(judgeAssignments)
          .innerJoin(user, eq(user.id, judgeAssignments.judgeUserId))
          .innerJoin(submissions, eq(submissions.id, judgeAssignments.submissionId))
          .where(eq(judgeAssignments.eventId, eventId));

      case "scores":
        return this.db
          .select({
            scoreId: scores.id,
            judgeEmail: user.email,
            submissionName: submissions.name,
            status: scores.status,
            rawWeightedScore: scores.rawWeightedScore,
            submittedAt: scores.submittedAt,
          })
          .from(scores)
          .innerJoin(judgeAssignments, eq(judgeAssignments.id, scores.judgeAssignmentId))
          .innerJoin(user, eq(user.id, judgeAssignments.judgeUserId))
          .innerJoin(submissions, eq(submissions.id, judgeAssignments.submissionId))
          .where(eq(judgeAssignments.eventId, eventId));

      case "normalized-results":
        return this.db
          .select({
            submissionName: submissions.name,
            rubricName: rubrics.name,
            method: normalizedResults.method,
            rawMean: normalizedResults.rawMean,
            normalizedMean: normalizedResults.normalizedMean,
            rank: normalizedResults.rank,
            computedAt: normalizedResults.computedAt,
          })
          .from(normalizedResults)
          .innerJoin(submissions, eq(submissions.id, normalizedResults.submissionId))
          .innerJoin(rubrics, eq(rubrics.id, normalizedResults.rubricId))
          .where(eq(rubrics.eventId, eventId));

      // FR-EXP-01's "final rankings" for a pairwise-mode track — the
      // Bradley-Terry equivalent of normalized-results above. Found live:
      // this resource didn't exist at all, so a pairwise-scored event had
      // no CSV path to its own final ranking, only rubric-mode did.
      case "pairwise-rankings":
        return this.db
          .select({
            submissionName: submissions.name,
            trackName: tracks.name,
            btStrength: pairwiseRankings.btStrength,
            rank: pairwiseRankings.rank,
            ciLow: pairwiseRankings.ciLow,
            ciHigh: pairwiseRankings.ciHigh,
            computedAt: pairwiseRankings.computedAt,
          })
          .from(pairwiseRankings)
          .innerJoin(submissions, eq(submissions.id, pairwiseRankings.submissionId))
          .innerJoin(tracks, eq(tracks.id, pairwiseRankings.trackId))
          .where(eq(pairwiseRankings.eventId, eventId));

      case "votes":
        // ipHash included deliberately — THREAT-MODEL.md's vote-abuse
        // section promises an organizer can "spot a cluster of votes from
        // one address" from this data. Found live: that claim was false
        // until this column was actually here to look at; the hash was
        // being stored per vote but never surfaced anywhere a human could
        // read it. Still just a hash, never the raw IP.
        return this.db
          .select({
            submissionName: submissions.name,
            voterId: votes.voterId,
            votesCast: votes.votesCast,
            costPaid: votes.costPaid,
            ipHash: votes.ipHash,
            createdAt: votes.createdAt,
          })
          .from(votes)
          .innerJoin(submissions, eq(submissions.id, votes.submissionId))
          .where(eq(votes.eventId, eventId));

      case "audit-log":
        return this.db
          .select({
            action: auditLogEntries.action,
            resourceType: auditLogEntries.resourceType,
            resourceId: auditLogEntries.resourceId,
            actorEmail: user.email,
            entryHash: auditLogEntries.entryHash,
            createdAt: auditLogEntries.createdAt,
          })
          .from(auditLogEntries)
          .leftJoin(user, eq(user.id, auditLogEntries.actorUserId))
          .where(eq(auditLogEntries.eventId, eventId));

      default:
        throw new BadRequestException({
          error: {
            code: ERROR_CODE.VALIDATION_ERROR,
            message: `Unknown export resource: ${resource}`,
          },
        });
    }
  }
}
