import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { RateLimiterService } from "../common/rate-limiter.service";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { SubmissionsController } from "./submissions.controller";
import { SubmissionsService } from "./submissions.service";

@Module({
  imports: [WebhooksModule, AuditModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, RateLimiterService],
})
export class SubmissionsModule {}
