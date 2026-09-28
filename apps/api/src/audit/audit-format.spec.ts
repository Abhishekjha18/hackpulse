import {
  ACTION_LABELS,
  type AuditLogRow,
  describeAuditEntry,
  type NameLookups,
} from "./audit-format";

function row(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: "row-1",
    eventId: "event-1",
    actorUserId: "actor-1",
    action: "vote.cast",
    resourceType: "submission",
    resourceId: "sub-1",
    metadata: {},
    createdAt: new Date("2026-09-24T00:00:00Z"),
    ...overrides,
  };
}

function emptyLookups(): NameLookups {
  return { userNames: new Map(), submissionNames: new Map(), trackNames: new Map() };
}

describe("describeAuditEntry", () => {
  it("resolves the actor's name from the lookup map", () => {
    const lookups = emptyLookups();
    lookups.userNames.set("actor-1", "Priya Sharma");
    const described = describeAuditEntry(row({}), lookups);
    expect(described.actorName).toBe("Priya Sharma");
  });

  it("labels a null actor as Anonymous, never crashing", () => {
    const described = describeAuditEntry(row({ actorUserId: null }), emptyLookups());
    expect(described.actorName).toBe("Anonymous");
  });

  it("falls back to Unknown user when the actor id isn't in the lookup map", () => {
    const described = describeAuditEntry(row({ actorUserId: "ghost" }), emptyLookups());
    expect(described.actorName).toBe("Unknown user");
  });

  it("gives every action string in ACTION_LABELS a non-empty human label", () => {
    for (const [action, label] of Object.entries(ACTION_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(action);
    }
  });

  it("falls back to the raw action string for an unmapped action", () => {
    const described = describeAuditEntry(row({ action: "something.new" }), emptyLookups());
    expect(described.actionLabel).toBe("something.new");
  });

  it("resolves a score action's resource label via metadata.submissionId", () => {
    const lookups = emptyLookups();
    lookups.submissionNames.set("sub-1", "Glass Signal");
    const described = describeAuditEntry(
      row({
        action: "score.submit",
        resourceType: "score",
        resourceId: "score-1",
        metadata: { submissionId: "sub-1" },
      }),
      lookups,
    );
    expect(described.resourceLabel).toBe('"Glass Signal"');
  });

  it("falls back to a generic label when a score's submission can't be resolved", () => {
    const described = describeAuditEntry(
      row({ action: "score.submit", resourceType: "score", resourceId: "score-1", metadata: {} }),
      emptyLookups(),
    );
    expect(described.resourceLabel).toBe("a submission");
  });

  it("resolves event_role.revoked's target from metadata.targetUserId, not the actor", () => {
    const lookups = emptyLookups();
    lookups.userNames.set("actor-1", "Organizer Name");
    lookups.userNames.set("target-1", "Judge Name");
    const described = describeAuditEntry(
      row({
        action: "event_role.revoked",
        resourceType: "event_role",
        resourceId: "role-1",
        metadata: { role: "judge", targetUserId: "target-1" },
      }),
      lookups,
    );
    expect(described.resourceLabel).toBe("Judge Name — judge");
  });

  it("labels an audit_log.access_denied entry by whether it has an eventId", () => {
    const perEvent = describeAuditEntry(
      row({
        action: "audit_log.access_denied",
        resourceType: "event",
        resourceId: "event-1",
        eventId: "event-1",
      }),
      emptyLookups(),
    );
    expect(perEvent.resourceLabel).toBe("this event's audit log");

    const global = describeAuditEntry(
      row({
        action: "audit_log.access_denied",
        resourceType: "instance",
        resourceId: "GLOBAL",
        eventId: null,
      }),
      emptyLookups(),
    );
    expect(global.resourceLabel).toBe("the instance-wide audit log");
  });

  it("resolves track_scope.access_denied's resource label from the track lookup", () => {
    const lookups = emptyLookups();
    lookups.trackNames.set("track-1", "Security");
    const described = describeAuditEntry(
      row({ action: "track_scope.access_denied", resourceType: "track", resourceId: "track-1" }),
      lookups,
    );
    expect(described.resourceLabel).toBe("Security");
  });

  it("falls back to 'a track' (not 'Unknown user') when the track can't be resolved", () => {
    const described = describeAuditEntry(
      row({
        action: "track_scope.access_denied",
        resourceType: "track",
        resourceId: "ghost-track",
      }),
      emptyLookups(),
    );
    expect(described.resourceLabel).toBe("a track");
  });

  it("falls back to 'a submission' (not 'Unknown user') when a deadline-rejected submission can't be resolved", () => {
    const described = describeAuditEntry(
      row({
        action: "submission.deadline_rejected",
        resourceType: "submission",
        resourceId: "ghost-submission",
      }),
      emptyLookups(),
    );
    expect(described.resourceLabel).toBe("a submission");
  });

  it("falls back to 'an account' (not 'Unknown user') when an auth event's account can't be resolved", () => {
    const described = describeAuditEntry(
      row({ action: "auth.sign_in", resourceType: "user", resourceId: "ghost-user" }),
      emptyLookups(),
    );
    expect(described.resourceLabel).toBe("an account");
  });

  it("never throws on a metadata field of the wrong type", () => {
    expect(() =>
      describeAuditEntry(
        row({ action: "event_role.granted", metadata: { role: 42, self: "yes" } }),
        emptyLookups(),
      ),
    ).not.toThrow();
  });
});
