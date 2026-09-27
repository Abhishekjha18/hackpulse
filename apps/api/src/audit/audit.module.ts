import { Module } from "@nestjs/common";

import { AuditController, AuditGlobalController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  controllers: [AuditController, AuditGlobalController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
