import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../db/client";
import { signingKeys } from "../db/schema";
import { DB } from "../db/tokens";

/**
 * One Ed25519 keypair per instance (FR-CERT-02), generated lazily on first
 * use and persisted in Postgres so it survives restarts: there is no
 * external KMS in a self-hosted, no-cloud-dependency system, so the
 * database *is* the key store. Advisory-locked so two concurrent first
 * uses can't each generate and insert a competing key.
 */
@Injectable()
export class SigningKeyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async getOrCreate() {
    const [existing] = await this.db.select().from(signingKeys).limit(1);
    if (existing) {
      return existing;
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(918273645)`);
      const [raced] = await tx.select().from(signingKeys).limit(1);
      if (raced) {
        return raced;
      }

      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const [row] = await tx
        .insert(signingKeys)
        .values({
          publicKeyId: randomUUID(),
          publicKeyDer: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
          privateKeyDer: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        })
        .returning();
      return row;
    });
  }

  async sign(data: string): Promise<{ signature: string; publicKeyId: string }> {
    const key = await this.getOrCreate();
    const privateKey = createPrivateKey({
      key: Buffer.from(key.privateKeyDer, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const signature = edSign(null, Buffer.from(data), privateKey).toString("base64");
    return { signature, publicKeyId: key.publicKeyId };
  }

  async verify(data: string, signature: string, publicKeyId: string): Promise<boolean> {
    const [key] = await this.db
      .select()
      .from(signingKeys)
      .where(eq(signingKeys.publicKeyId, publicKeyId));
    if (!key) {
      return false;
    }

    const publicKey = createPublicKey({
      key: Buffer.from(key.publicKeyDer, "base64"),
      format: "der",
      type: "spki",
    });
    return edVerify(null, Buffer.from(data), publicKey, Buffer.from(signature, "base64"));
  }
}
