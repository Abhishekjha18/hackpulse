import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CERTIFICATE_TYPE, WEBHOOK_EVENT } from "@hackpulse/shared";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject } from "@nestjs/common";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";

import type { Database } from "../db/client";
import { certificates, events, user } from "../db/schema";
import { DB } from "../db/tokens";
import { WebhooksService } from "../webhooks/webhooks.service";
import { renderCertificatePdf } from "./certificate-renderer";
import { CERTIFICATES_DIR, CertificatesService } from "./certificates.service";
interface RenderJobData {
  certificateId: string;
}

const TITLES: Record<string, string> = {
  participation: "Certificate of Participation",
  winner: "Certificate of Achievement",
  judge: "Certificate of Judging Participation",
};

@Processor("certificates")
export class CertificateProcessor extends WorkerHost {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly certificatesService: CertificatesService,
    private readonly webhooks: WebhooksService,
  ) {
    super();
  }

  async process(job: Job<RenderJobData>): Promise<void> {
    const [cert] = await this.db
      .select()
      .from(certificates)
      .where(eq(certificates.id, job.data.certificateId));
    if (!cert) {
      return;
    }

    const [event] = await this.db.select().from(events).where(eq(events.id, cert.eventId));
    const [recipient] = await this.db.select().from(user).where(eq(user.id, cert.recipientUserId));

    let verifyUrl: string | undefined;
    if (cert.type === CERTIFICATE_TYPE.JUDGE) {
      const record = await this.certificatesService.issueJudgeRecord(
        cert.eventId,
        cert.recipientUserId,
      );
      const base = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
      verifyUrl = `${base}/api/v1/verify/judge-record/${record.id}`;
    }

    const pdfBytes = await renderCertificatePdf({
      title: TITLES[cert.type] ?? "Certificate",
      recipientName: recipient?.name ?? "Participant",
      eventName: event?.name ?? "Hackathon",
      issuedAt: cert.issuedAt,
      verifyUrl,
    });

    await mkdir(CERTIFICATES_DIR, { recursive: true });
    const filename = `${cert.id}.pdf`;
    await writeFile(join(CERTIFICATES_DIR, filename), pdfBytes);

    await this.db
      .update(certificates)
      .set({ pdfObjectKey: filename })
      .where(eq(certificates.id, cert.id));

    if (cert.type !== CERTIFICATE_TYPE.JUDGE) {
      // judge-type already fired certificate.issued from issueJudgeRecord
      await this.webhooks.trigger(cert.eventId, WEBHOOK_EVENT.CERTIFICATE_ISSUED, {
        certificateId: cert.id,
        type: cert.type,
        recipientUserId: cert.recipientUserId,
      });
    }
  }
}
