import { voteBlockReason } from "./vote-eligibility.util";

const base = { status: "judging", eventRoles: [] as string[], isTeamMember: false };

// F6 (found live): team owners voted for their own project, judges voted,
// and voting was not tied to the event's lifecycle at all.
describe("voteBlockReason", () => {
  it("allows an ordinary participant while the event is running", () => {
    for (const status of ["registration_open", "submissions_open", "judging"]) {
      expect(voteBlockReason({ ...base, status })).toBeNull();
    }
  });

  it("blocks voting outside the event's running phases", () => {
    for (const status of ["draft", "results_published", "archived"]) {
      expect(voteBlockReason({ ...base, status })).toBe("VOTING_CLOSED");
    }
  });

  it("blocks a member of the team being voted for", () => {
    expect(voteBlockReason({ ...base, isTeamMember: true })).toBe("OWN_SUBMISSION");
  });

  it("blocks the event's judges and organizers", () => {
    expect(voteBlockReason({ ...base, eventRoles: ["judge"] })).toBe("EVENT_STAFF");
    expect(voteBlockReason({ ...base, eventRoles: ["organizer"] })).toBe("EVENT_STAFF");
  });

  it("checks the phase before who is voting", () => {
    expect(voteBlockReason({ status: "archived", eventRoles: ["judge"], isTeamMember: true })).toBe(
      "VOTING_CLOSED",
    );
  });
});
