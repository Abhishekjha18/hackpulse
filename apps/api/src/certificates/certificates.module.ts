import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";

import { WebhooksModule } from "../webhooks/webhooks.module";
import { CertificateProcessor } from "./certificate.processor";
import { CertificatesController } from "./certificates.controller";
import { CertificatesService } from "./certificates.service";
import { SigningKeyService } from "./signing-key.service";

@Module({
  imports: [BullModule.registerQueue({ name: "certificates" }), WebhooksModule],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateProcessor, SigningKeyService],
})
export class CertificatesModule {}
