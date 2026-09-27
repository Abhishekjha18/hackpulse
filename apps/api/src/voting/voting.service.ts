import type { CastVoteInput, CurrentUser } from "@hackpulse/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";

import { AuditService } from "../audit/audit.service";
import { RateLimiterService } from "../common/rate-limiter.service";
import type { Database } from "../db/client";
import { events, submissions, teams, votes } from "../db/schema";
import { DB } from "../db/tokens";
import { seededShuffle } from "./seeded-shuffle";

// FR-VOTE-02: "casting n votes costs the square root of n in influence."
// A fixed per-voter, per-event budget of influence; the classic quadratic
// property (doubling votes on one project costs much more than linear)
// falls out of summing sqrt(n) across submissions against this budget.
const QUADRATIC_BUDGET = 10;

export interface VoterIdentity {
  voterId: string;
  isAuthenticated: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class VotingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly rateLimiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  // Ballot viewing only needs a stable identity to seed the per-voter
  // shuffle (FR-VOTE-03); it isn't the "may this voter cast a vote" gate,
  // so it stays access-mode-agnostic and keeps accepting either an account
  // or a client-generated token.
  resolveVoter(currentUser: CurrentUser | null, voterToken: string | undefined): VoterIdentity {
    if (currentUser) {
      return { voterId: `user:${currentUser.id}`, isAuthenticated: true };
    }
    if (voterToken) {
      return { voterId: `anon:${voterToken}`, isAuthenticated: false };
    }
    throw new BadRequestException({
      error: {
        code: "VALIDATION_ERROR",
        message: "Anonymous voting requires an X-Voter-Token header (client-generated, persisted)",
      },
    });
  }

  // The actual "may this voter cast a vote" gate, branching on the event's
  // votingAccess. Found live: email_gated was accepted everywhere as a
  // valid value but nothing branched on it, so it silently behaved like
  // open_link. With no outbound email (NFR-OPS-01), there's no way to
  // verify the address is really the voter's; email_gated only raises the
  // bar from "clear your browser storage to vote again" to "type a new
  // email each time," not to verified-identity voting.
  private resolveVoterForCasting(
    event: { votingAccess: string },
    currentUser: CurrentUser | null,
    voterToken: string | undefined,
    voterEmail: string | undefined,
  ): VoterIdentity {
    if (currentUser) {
      return { voterId: `user:${currentUser.id}`, isAuthenticated: true };
    }

    if (event.votingAccess === "authenticated") {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "This event requires an account to vote" },
      });
    }

    if (event.votingAccess === "email_gated") {
      const normalized = voterEmail?.trim().toLowerCase();
      if (!normalized || !EMAIL_PATTERN.test(normalized)) {
        throw new BadRequestException({
          error: {
            code: "VALIDATION_ERROR",
            message: "This event requires a valid email address to vote (X-Voter-Email header)",
          },
        });
      }
      return { voterId: `email:${normalized}`, isAuthenticated: false };
    }

    // open_link
    return this.resolveVoter(currentUser, voterToken);
  }

  // FR-VOTE-03: deterministic-per-voter randomized order.
  async getBallot(eventId: string, voter: VoterIdentity) {
    const rows = await this.db
      .select({ submission: submissions })
      .from(submissions)
      .innerJoin(teams, eq(teams.id, submissions.teamId))
      .where(and(eq(teams.eventId, eventId), eq(submissions.status, "submitted")));

    const list = rows.map((r) => r.submission);
    return seededShuffle(list, `${eventId}|${voter.voterId}`);
  }

  async castVote(
    eventId: string,
    input: CastVoteInput,
    currentUser: CurrentUser | null,
    voterToken: string | undefined,
    voterEmail: string | undefined,
    ipHash: string,
  ) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    if (event.votingMode === "disabled") {
      throw new ForbiddenException({
        error: { code: "FORBIDDEN", message: "Voting is not enabled for this event" },
      });
    }

    // Resolved here, after the event is loaded, because which identity is
    // even acceptable (account / token / email) depends on the event's
    // own votingAccess setting.
    const voter = this.resolveVoterForCasting(event, currentUser, voterToken, voterEmail);

    if (!this.rateLimiter.consume("vote", voter.voterId, 60_000, 20)) {
      throw new HttpException(
        { error: { code: "RATE_LIMITED", message: "Too many votes cast, please slow down" } },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [submission] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, input.submissionId));
    if (!submission || submission.status !== "submitted") {
      throw new NotFoundException();
    }

    let votesCast = 1;
    let cost = 1;

    if (event.votingMode === "single_vote") {
      if (input.votes !== 1) {
        throw new BadRequestException({
          error: {
            code: "VALIDATION_ERROR",
            message: "This event allows exactly one vote per submission",
          },
        });
      }
    } else {
      votesCast = input.votes;
      cost = Math.sqrt(votesCast);

      const [{ spent }] = await this.db
        .select({ spent: sql<string>`coalesce(sum(${votes.costPaid}), 0)` })
        .from(votes)
        .where(
          and(
            eq(votes.eventId, eventId),
            eq(votes.voterId, voter.voterId),
            ne(votes.submissionId, input.submissionId),
          ),
        );

      const remaining = QUADRATIC_BUDGET - Number(spent);
      if (cost > remaining) {
        throw new ConflictException({
          error: {
            code: "CONFLICT",
            message: `Not enough voice credits left (${remaining.toFixed(2)} remaining, this costs ${cost.toFixed(2)})`,
          },
        });
      }
    }

    const [row] = await this.db
      .insert(votes)
      .values({
        eventId,
        submissionId: input.submissionId,
        voterId: voter.voterId,
        votesCast,
        costPaid: cost.toString(),
        ipHash,
      })
      .onConflictDoUpdate({
        target: [votes.eventId, votes.submissionId, votes.voterId],
        set: { votesCast, costPaid: cost.toString() },
      })
      .returning();

    await this.audit.log({
      eventId,
      actorUserId: voter.isAuthenticated ? voter.voterId.slice("user:".length) : null,
      action: "vote.cast",
      resourceType: "submission",
      resourceId: input.submissionId,
      metadata: { votesCast, cost, voterId: voter.voterId },
    });

    return row;
  }

  // FR-RESULT-02: hidden from everyone but organizers until published.
  async getTally(eventId: string, isPrivileged: boolean) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }
    if (event.status !== "results_published" && !isPrivileged) {
      throw new ForbiddenException();
    }

    const rows = await this.db
      .select({
        submissionId: votes.submissionId,
        totalVotes: sql<string>`sum(${votes.votesCast})`,
        voterCount: sql<string>`count(distinct ${votes.voterId})`,
      })
      .from(votes)
      .where(eq(votes.eventId, eventId))
      .groupBy(votes.submissionId);

    return rows.map((r) => ({
      submissionId: r.submissionId,
      totalVotes: Number(r.totalVotes),
      voterCount: Number(r.voterCount),
    }));
  }
}
