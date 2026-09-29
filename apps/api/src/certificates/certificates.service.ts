import { type CurrentUser, ERROR_CODE, WEBHOOK_EVENT } from "@hackpulse/shared";
import { InjectQueue } from "@nestjs/bullmq";
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";

import { canonicalStringify } from "../audit/audit.service";
import { isEventOrganizer } from "../common/auth/is-event-organizer";
import type { Database } from "../db/client";
import { certificates, events, judgeParticipationRecords, user } from "../db/schema";
import { DB } from "../db/tokens";
import { WebhooksService } from "../webhooks/webhooks.service";
import { SigningKeyService } from "./signing-key.service";

export const CERTIFICATES_DIR = process.env.CERTIFICATES_DIR ?? "./data/certificates";

type CertificateType = "participation" | "winner" | "judge";

@Injectable()
export class CertificatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly signingKey: SigningKeyService,
    private readonly webhooks: WebhooksService,
    @InjectQueue("certificates") private readonly queue: Queue,
  ) {}

  // FR-CERT-01 — queued, not rendered inline; PDF generation is exactly
  // the kind of slow, non-critical-path work ADR-007 reserves the queue
  // for.
  async generate(eventId: string, type: CertificateType, recipientUserIds: string[]) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const created = [];
    for (const recipientUserId of recipientUserIds) {
      const [cert] = await this.db
        .insert(certificates)
        .values({ eventId, recipientUserId, type })
        .returning();
      created.push(cert);
      await this.queue.add("render", { certificateId: cert.id });
    }
    return created;
  }

  async getCertificate(certificateId: string, currentUser: CurrentUser) {
    const [cert] = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, certificateId));
    if (!cert) {
      throw new NotFoundException();
    }
    if (cert.recipientUserId !== currentUser.id && !isEventOrganizer(currentUser, cert.eventId)) {
      throw new ForbiddenException();
    }
    if (!cert.pdfObjectKey) {
      throw new NotFoundException({
        error: { code: ERROR_CODE.NOT_FOUND, message: "Certificate is still being generated" },
      });
    }
    return cert;
  }

  // FR-CERT-02 — the signed record itself; called by the render worker for
  // type='judge' certificates, and directly issuable without a PDF too.
  async issueJudgeRecord(eventId: string, judgeUserId: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, eventId));
    if (!event) {
      throw new NotFoundException();
    }

    const payload = {
      eventId,
      judgeUserId,
      eventName: event.name,
      issuedAt: new Date().toISOString(),
    };
    const { signature, publicKeyId } = await this.signingKey.sign(canonicalStringify(payload));

    const [record] = await this.db
      .insert(judgeParticipationRecords)
      .values({ eventId, judgeUserId, payload, signature, publicKeyId })
      .returning();

    await this.webhooks.trigger(eventId, WEBHOOK_EVENT.CERTIFICATE_ISSUED, {
      recordId: record.id,
      judgeUserId,
      type: "judge_participation_record",
    });

    return record;
  }

  // Public, unauthenticated — the entire point of a signature is that
  // anyone can check it without trusting the server's say-so.
  async verifyJudgeRecord(recordId: string) {
    const [record] = await this.db
      .select()
      .from(judgeParticipationRecords)
      .where(eq(judgeParticipationRecords.id, recordId));
    if (!record) {
      return { valid: false as const };
    }

    const canonical = canonicalStringify(record.payload);
    const valid = await this.signingKey.verify(canonical, record.signature, record.publicKeyId);
    return { valid, payload: valid ? record.payload : undefined };
  }

  async getRecipientName(userId: string): Promise<string> {
    const [row] = await this.db.select({ name: user.name }).from(user).where(eq(user.id, userId));
    return row?.name ?? "Participant";
  }

  // Found live: a certificate's only download link lived in the
  // organizer's dashboard; a recipient had no page of their own showing
  // what had been issued to them. Covers both tables (PDF certificates,
  // signed judge records), scoped by recipient.
  async findMineForUser(userId: string) {
    const [certRows, judgeRecordRows] = await Promise.all([
      this.db
        .select({
          id: certificates.id,
          eventId: certificates.eventId,
          eventName: events.name,
          type: certificates.type,
          issuedAt: certificates.issuedAt,
          ready: certificates.pdfObjectKey,
        })
        .from(certificates)
        .innerJoin(events, eq(events.id, certificates.eventId))
        .where(eq(certificates.recipientUserId, userId)),
      this.db
        .select({
          id: judgeParticipationRecords.id,
          eventId: judgeParticipationRecords.eventId,
          eventName: events.name,
          issuedAt: judgeParticipationRecords.issuedAt,
        })
        .from(judgeParticipationRecords)
        .innerJoin(events, eq(events.id, judgeParticipationRecords.eventId))
        .where(eq(judgeParticipationRecords.judgeUserId, userId)),
    ]);

    return {
      certificates: certRows.map((c) => ({ ...c, ready: c.ready !== null })),
      judgeRecords: judgeRecordRows,
    };
  }
}
