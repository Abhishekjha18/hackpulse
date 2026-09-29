import { AUDIT_ACTION, type CurrentUser as CurrentUserType, ERROR_CODE } from "@hackpulse/shared";
import { BadRequestException, Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { AuditService } from "../audit/audit.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ArchiveService } from "./archive.service";
import { parseCsv, toCsv } from "./csv";
import {
  CSV_IMPORTABLE_RESOURCES,
  type CsvImportableResource,
  CsvImportService,
} from "./csv-import.service";
import { EXPORTABLE_RESOURCES, type ExportableResource, ExportService } from "./export.service";

// Requested explicitly: every per-resource import/export path should
// support both CSV (FR-BULK-01/FR-EXP-01's own required format) and JSON
// as an equivalent alternative, since both are just rows of the same
// shape. The full event archive (FR-BULK-02) is deliberately excluded —
// it's a relational graph, not a flat resource, so there's no equally
// simple CSV form for it.
function coerceJsonRowsToStrings(json: unknown): Record<string, string>[] {
  if (!Array.isArray(json)) {
    throw new BadRequestException({
      error: {
        code: ERROR_CODE.VALIDATION_ERROR,
        message: '"json" must be an array of row objects',
      },
    });
  }
  return json.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: 'Each row in "json" must be an object',
        },
      });
    }
    return Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([k, v]) => [
        // Found live: parseCsv (csv.ts) trims both header names and cell
        // values, but this JSON path only stringified without trimming --
        // " Team A " and "Team A" would then fail the exact-name/email
        // dedup checks in CsvImportService (ilike doesn't trim either), a
        // whitespace edge case CSV happened to already close and JSON
        // didn't. Trimming both here keeps the two formats behaviorally
        // identical, matching what CSV_IMPORT_SCHEMAS documents as one
        // shared contract regardless of encoding.
        k.trim(),
        v === null || v === undefined ? "" : String(v).trim(),
      ]),
    );
  });
}

@Controller("events/:eventId")
export class BulkExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly archive: ArchiveService,
    private readonly csvImport: CsvImportService,
    private readonly audit: AuditService,
  ) {}

  // Declared before the parameterized :resourceWithExt route for clarity;
  // Fastify's router prioritizes the static segment regardless.
  @Get("export/archive")
  @Roles("organizer")
  async exportArchive(@Param("eventId") eventId: string, @CurrentUser() user: CurrentUserType) {
    const result = await this.archive.exportArchive(eventId);
    // FR-ABUSE-05 "export" — logged after the export actually succeeds.
    await this.audit.log({
      eventId,
      actorUserId: user.id,
      action: AUDIT_ACTION.EXPORT_ARCHIVE,
      resourceType: "event",
      resourceId: eventId,
    });
    return result;
  }

  // FR-EXP-01 — export at every stage, CSV (the required format) or JSON
  // (added on request: the same rows either way, so a second format is
  // cheap here — see coerceJsonRowsToStrings's comment for why the full
  // archive doesn't get the same treatment). :resourceWithExt carries the
  // extension (e.g. "teams.csv" or "teams.json") rather than using a
  // literal dot in the route template, which not every router handles the
  // same way.
  @Get("export/:resourceWithExt")
  @Roles("organizer")
  async exportCsv(
    @Param("eventId") eventId: string,
    @Param("resourceWithExt") resourceWithExt: string,
    @CurrentUser() user: CurrentUserType,
    @Res() reply: FastifyReply,
  ) {
    const match = resourceWithExt.match(/^(.+)\.(csv|json)$/);
    const resource = match ? match[1] : resourceWithExt;
    const format = match ? match[2] : "csv";
    if (!EXPORTABLE_RESOURCES.includes(resource as ExportableResource)) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: `resource must be one of: ${EXPORTABLE_RESOURCES.join(", ")}`,
        },
      });
    }

    const rows = await this.exportService.export(eventId, resource as ExportableResource);
    // FR-ABUSE-05 "export" — logged after the export actually succeeds,
    // before the reply is sent (the reply itself can't fail this call).
    await this.audit.log({
      eventId,
      actorUserId: user.id,
      action: AUDIT_ACTION.EXPORT_CSV,
      resourceType: "event",
      resourceId: eventId,
      metadata: { resource, format },
    });
    if (format === "json") {
      reply.header("Content-Type", "application/json; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${resource}.json"`);
      reply.send(JSON.stringify(rows, null, 2));
      return;
    }
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${resource}.csv"`);
    reply.send(toCsv(rows as Record<string, unknown>[]));
  }

  // FR-BULK-01 — bulk-import registrations/teams/submissions, one row at
  // a time. CSV is the required format (a "csv" field, its text); JSON is
  // also accepted (a "json" field, an array of row objects) as an
  // equivalent alternative, added on request — both end up as the exact
  // same Record<string, string>[] shape before validation, so the import
  // logic itself never needs to know which encoding was used. Either
  // field travels as JSON (not a raw text/csv or multipart body): this
  // stays consistent with the rest of the API (JSON in, JSON out) without
  // pulling in a multipart-parsing dependency for a single upload
  // endpoint.
  @Post("import/:resource")
  @Roles("organizer")
  async importCsv(
    @Param("eventId") eventId: string,
    @Param("resource") resource: string,
    @Body() body: { csv?: string; json?: unknown[] },
    @CurrentUser() user: CurrentUserType,
  ) {
    if (!CSV_IMPORTABLE_RESOURCES.includes(resource as CsvImportableResource)) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: `resource must be one of: ${CSV_IMPORTABLE_RESOURCES.join(", ")}`,
        },
      });
    }
    if (!body?.csv && !body?.json) {
      throw new BadRequestException({
        error: {
          code: ERROR_CODE.VALIDATION_ERROR,
          message: 'Request body must include a "csv" or a "json" field',
        },
      });
    }
    const rows = body.json ? coerceJsonRowsToStrings(body.json) : parseCsv(body.csv!);

    const report = await this.csvImport.import(eventId, resource as CsvImportableResource, rows);
    // FR-ABUSE-05 "import" — logged once per upload, not per row; the
    // per-row outcome is in the response, not the audit trail.
    await this.audit.log({
      eventId,
      actorUserId: user.id,
      action: AUDIT_ACTION.IMPORT_CSV,
      resourceType: "event",
      resourceId: eventId,
      metadata: {
        resource,
        format: body.json ? "json" : "csv",
        succeeded: report.succeeded,
        failed: report.failed,
      },
    });
    return report;
  }
}

@Controller("import")
export class BulkImportController {
  constructor(private readonly archive: ArchiveService) {}

  // No @Roles() — importing creates a brand-new event and its importer
  // becomes that event's organizer, the same as POST /events (there is no
  // existing event's role to check yet).
  @Post("archive")
  importArchive(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.archive.importArchive(body, user);
  }
}
