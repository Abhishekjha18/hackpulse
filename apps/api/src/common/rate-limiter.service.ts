import { Injectable } from "@nestjs/common";

/**
 * In-memory sliding-window rate limiter (FR-ABUSE-01). Deliberately not
 * Redis-backed: this is a single-instance self-hosted deployment
 * (ARCHITECTURE.md — one `api` container), so a process-local Map is both
 * sufficient and one fewer moving part. Revisit if `api` is ever scaled
 * horizontally.
 */
@Injectable()
export class RateLimiterService {
  private hits = new Map<string, number[]>();

  /** Returns true if the call is allowed, false if the caller is over the
   * limit for this bucket+key within the window. */
  consume(bucket: string, key: string, windowMs: number, max: number): boolean {
    const mapKey = `${bucket}:${key}`;
    const now = Date.now();
    const recent = (this.hits.get(mapKey) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      this.hits.set(mapKey, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(mapKey, recent);
    return true;
  }
}
