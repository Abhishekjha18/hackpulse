import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { JudgingModule } from "../judging/judging.module";
import { VotingModule } from "../voting/voting.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { ResultsController } from "./results.controller";
import { ResultsService } from "./results.service";

@Module({
  imports: [JudgingModule, VotingModule, AuditModule, WebhooksModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
