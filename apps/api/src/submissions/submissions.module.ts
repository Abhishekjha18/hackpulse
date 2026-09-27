import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { RateLimiterService } from "../common/rate-limiter.service";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [AuditModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, RateLimiterService],
})
export class SubmissionsModule {}
