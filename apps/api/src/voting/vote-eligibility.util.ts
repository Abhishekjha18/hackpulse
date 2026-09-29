// Who may vote and when, as pure rules so they can be tested without a
// database. VotingService supplies the facts (status, roles, team
// membership) and turns a non-null reason into an HTTP error.

// Only the statuses that are unambiguously not a voting phase are blocked.
// An event running on automatic dates can leave its *stored* status stale
// in the three middle phases (the clock, not the column, is the truth
// there), so blocking those could reject legitimate votes.
const CLOSED_STATUSES = new Set(["draft", "results_published", "archived"]);

export type VoteBlockReason = "EVENT_STAFF" | "OWN_SUBMISSION" | "VOTING_CLOSED";

export function voteBlockReason(input: {
  status: string;
  eventRoles: string[];
  isTeamMember: boolean;
}): VoteBlockReason | null {
  if (CLOSED_STATUSES.has(input.status)) {
    return "VOTING_CLOSED";
  }
  if (input.eventRoles.includes("judge") || input.eventRoles.includes("organizer")) {
    return "EVENT_STAFF";
  }
  if (input.isTeamMember) {
    return "OWN_SUBMISSION";
  }
  return null;
}
