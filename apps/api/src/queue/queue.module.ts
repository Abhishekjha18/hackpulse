import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

// ADR-007: normalization recompute stays synchronous (small, fast, and
// the caller benefits from seeing the result immediately), but webhook
// delivery and certificate rendering are genuinely slow/unreliable
// external work that must not block the request that triggered them.
@Module({
  imports: [BullModule.forRoot({ connection: { host: "localhost", port: 6379 } })],
  exports: [BullModule],
})
export class QueueModule {}
