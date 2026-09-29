import { ERROR_CODE, SUBMISSION_STATUS } from "@hackpulse/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, ilike } from "drizzle-orm";

import type { Database } from "../db/client";
import { events, submissions, teamMembers, teams, tracks, user } from "../db/schema";
import { DB } from "../db/tokens";
import { generateInviteCode } from "../teams/invite-code";
export const CSV_IMPORTABLE_RESOURCES = ["teams", "registrations", "submissions"] as const;
export type CsvImportableResource = (typeof CSV_IMPORTABLE_RESOURCES)[number];

// FR-BULK-01's documented column schema — the organizer-facing contract for
// what a CSV upload must contain. Extra columns are ignored; missing
// required ones fail that row, not the whole file.
export const CSV_IMPORT_SCHEMAS: Record<
  CsvImportableResource,
  { required: string[]; optional: string[] }
> = {
  teams: { required: ["name", "ownerEmail"], optional: [] },
  registrations: { required: ["teamName", "userEmail"], optional: [] },
  submissions: {
    required: ["teamName", "trackName", "name"],
    optional: ["tagline", "description", "repoUrl", "liveUrl", "demoVideoUrl"],
  },
};

export interface RowResult {
  row: number;
  status: "created" | "error";
  message?: string;
}

export interface ImportReport {
  total: number;
  succeeded: number;
  failed: number;
  results: RowResult[];
}

/**
 * FR-BULK-01 — per-row, not all-or-nothing: each data row is validated and
 * applied independently inside its own small transaction, so one bad row
 * (a typo'd email, a track name that doesn't exist yet) reports an error
 * for that row alone and never rolls back the rows around it.
 */
@Injectable()
export class CsvImportService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Takes already-parsed rows, not raw CSV text — requested explicitly:
  // the same column schema and per-row validation should accept a JSON
  // array of row objects too, not just CSV. Parsing (csv text -> rows, or
  // a JSON array -> rows) happens in the controller, which is the only
  // place that knows which encoding the request actually used; everything
  // below is format-agnostic once it has plain row objects.
  async import(
    eventId: string,
    resource: CsvImportableResource,
    rows: Record<string, string>[],
  ): Promise<ImportReport> {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        error: { code: ERROR_CODE.VALIDATION_ERROR, message: "No data rows to import" },
      });
    }

    const schema = CSV_IMPORT_SCHEMAS[resource];
    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 1;
      const row = rows[i];
      const missing = schema.required.filter((col) => !row[col]);
      if (missing.length > 0) {
        results.push({
          row: rowNumber,
          status: "error",
          message: `Missing required column(s): ${missing.join(", ")}`,
        });
        continue;
      }

      try {
        switch (resource) {
          case "teams":
            await this.importTeamRow(eventId, row);
            break;
          case "registrations":
            await this.importRegistrationRow(eventId, row);
            break;
          case "submissions":
            await this.importSubmissionRow(eventId, row);
            break;
        }
        results.push({ row: rowNumber, status: "created" });
      } catch (err) {
        results.push({
          row: rowNumber,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const succeeded = results.filter((r) => r.status === "created").length;
    return { total: results.length, succeeded, failed: results.length - succeeded, results };
  }

  private async resolveUserByEmail(email: string) {
    const [row] = await this.db.select({ id: user.id }).from(user).where(ilike(user.email, email));
    if (!row) {
      throw new Error(`No account on this instance matches ${email}`);
    }
    return row.id;
  }

  // Found live: TeamsService.findMine (apps/api/src/teams/teams.service.ts)
  // reads only the first team_members row for a given (event, user) and
  // has always assumed there's at most one — never enforced anywhere at
  // insert time until now. Both rows below check for that before inserting
  // a new membership, the same guard TeamsService.create/join now apply.
  private async assertNotAlreadyOnATeam(eventId: string, userId: string, email: string) {
    const [existing] = await this.db
      .select({ teamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(and(eq(teams.eventId, eventId), eq(teamMembers.userId, userId)));
    if (existing) {
      throw new Error(`${email} is already on team "${existing.teamName}" for this event`);
    }
  }

  private async importTeamRow(eventId: string, row: Record<string, string>) {
    const [existing] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), ilike(teams.name, row.name)));
    if (existing) {
      throw new Error(`A team named "${row.name}" already exists for this event`);
    }

    const ownerUserId = await this.resolveUserByEmail(row.ownerEmail);
    await this.assertNotAlreadyOnATeam(eventId, ownerUserId, row.ownerEmail);

    const [team] = await this.db
      .insert(teams)
      .values({ eventId, name: row.name, ownerUserId, inviteCode: generateInviteCode() })
      .returning();
    // The API's own team-creation endpoint (TeamsService.create) makes the
    // owner a team_members row too, not just teams.owner_user_id — without
    // this, an imported team's owner wouldn't show up on their own team's
    // member list or "my team" page.
    await this.db.insert(teamMembers).values({ teamId: team.id, userId: ownerUserId });
  }

  // Shared by importRegistrationRow and importSubmissionRow — both key off
  // a team by its (case-insensitive) name within the event rather than an
  // id, since a bulk-import CSV is human-authored and only ever has the
  // name to go on.
  private async findTeamByNameOrThrow(eventId: string, teamName: string) {
    const [team] = await this.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.eventId, eventId), ilike(teams.name, teamName)));
    if (!team) {
      throw new Error(`No team named "${teamName}" exists for this event`);
    }
    return team;
  }

  private async importRegistrationRow(eventId: string, row: Record<string, string>) {
    const team = await this.findTeamByNameOrThrow(eventId, row.teamName);

    const userId = await this.resolveUserByEmail(row.userEmail);
    await this.assertNotAlreadyOnATeam(eventId, userId, row.userEmail);

    await this.db.insert(teamMembers).values({ teamId: team.id, userId });
  }

  private async importSubmissionRow(eventId: string, row: Record<string, string>) {
    const team = await this.findTeamByNameOrThrow(eventId, row.teamName);

    const [track] = await this.db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.eventId, eventId), ilike(tracks.name, row.trackName)));
    if (!track) {
      throw new Error(`No track named "${row.trackName}" exists for this event`);
    }

    const [existing] = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.teamId, team.id), eq(submissions.trackId, track.id)));
    if (existing) {
      throw new Error(
        `Team "${row.teamName}" already has a submission in track "${row.trackName}"`,
      );
    }

    await this.db.insert(submissions).values({
      teamId: team.id,
      trackId: track.id,
      name: row.name,
      tagline: row.tagline ?? "",
      description: row.description ?? "",
      repoUrl: row.repoUrl || null,
      liveUrl: row.liveUrl || null,
      demoVideoUrl: row.demoVideoUrl || null,
      // Imported entries are final entries, not drafts: judge assignment and
      // the judging queue only consider submitted projects, so a draft here
      // would leave an imported event with nothing to judge.
      status: SUBMISSION_STATUS.SUBMITTED,
      submittedAt: new Date(),
    });
  }
}
