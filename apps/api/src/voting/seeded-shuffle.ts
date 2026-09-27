import { createHash } from "node:crypto";

/** mulberry32: small, fast, deterministic PRNG from a 32-bit seed. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(key: string): number {
  const hash = createHash("sha256").update(key).digest();
  return hash.readUInt32BE(0);
}

/** FR-VOTE-03: randomizes ballot order to kill position bias, but
 * deterministically per (eventId, voterId), so the same voter reloading the
 * ballot sees the same order rather than a confusing re-shuffle. */
export function seededShuffle<T>(items: T[], seedKey: string): T[] {
  const rng = mulberry32(seedFrom(seedKey));
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
