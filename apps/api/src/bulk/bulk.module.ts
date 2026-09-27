import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ArchiveService } from "./archive.service";
import { BulkExportController, BulkImportController } from "./bulk.controller";
import { CsvImportService } from "./csv-import.service";
import { ExportService } from "./export.service";

@Module({
  imports: [AuditModule],
  controllers: [BulkExportController, BulkImportController],
  providers: [ExportService, ArchiveService, CsvImportService],
})
export class BulkModule {}
