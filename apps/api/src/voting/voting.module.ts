import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { RateLimiterService } from "../common/rate-limiter.service";
import { VotingController } from "./voting.controller";
import { VotingService } from "./voting.service";

@Module({
  imports: [AuditModule],
  controllers: [VotingController],
  providers: [VotingService, RateLimiterService],
  exports: [VotingService],
})
export class VotingModule {}
