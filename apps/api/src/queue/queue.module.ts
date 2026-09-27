import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
  };
}

// ADR-007: normalization recompute stays synchronous (small, fast, and
// the caller benefits from seeing the result immediately), but webhook
// delivery and certificate rendering are genuinely slow/unreliable
// external work that must not block the request that triggered them.
@Module({
  imports: [BullModule.forRoot({ connection: redisConnection() })],
  exports: [BullModule],
})
export class QueueModule {}
