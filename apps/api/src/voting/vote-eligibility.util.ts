import { EVENT_ROLE, EVENT_STATUS } from "@hackpulse/shared";
// Who may vote and when, as pure rules so they can be tested without a
// database. VotingService supplies the facts (status, roles, team
// membership) and turns a non-null reason into an HTTP error.

// Only the statuses that are unambiguously not a voting phase are blocked.
// An event running on automatic dates can leave its *stored* status stale
// in the three middle phases (the clock, not the column, is the truth
// there), so blocking those could reject legitimate votes.
const CLOSED_STATUSES = new Set<string>([
  EVENT_STATUS.DRAFT,
  EVENT_STATUS.RESULTS_PUBLISHED,
  EVENT_STATUS.ARCHIVED,
]);

export type VoteBlockReason = "EVENT_STAFF" | "OWN_SUBMISSION" | "VOTING_CLOSED";

export function voteBlockReason(input: {
  status: string;
  eventRoles: string[];
  isTeamMember: boolean;
}): VoteBlockReason | null {
  if (CLOSED_STATUSES.has(input.status)) {
    return "VOTING_CLOSED";
  }
  if (
    input.eventRoles.includes(EVENT_ROLE.JUDGE) ||
    input.eventRoles.includes(EVENT_ROLE.ORGANIZER)
  ) {
    return "EVENT_STAFF";
  }
  if (input.isTeamMember) {
    return "OWN_SUBMISSION";
  }
  return null;
}
