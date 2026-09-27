import { createReadStream } from "node:fs";
import { join } from "node:path";

import { type CurrentUser as CurrentUserType, GenerateCertificatesInput } from "@hackpulse/shared";
import { Body, Controller, Get, Param, Post, Res, StreamableFile } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CERTIFICATES_DIR, CertificatesService } from "./certificates.service";

@Controller()
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post("events/:eventId/certificates/generate")
  @Roles("organizer")
  generate(
    @Param("eventId") eventId: string,
    @Body(new ZodValidationPipe(GenerateCertificatesInput)) body: GenerateCertificatesInput,
  ) {
    return this.certificates.generate(eventId, body.type, body.recipientIds);
  }

  // eventId is unused in the handler but kept in the path so RolesGuard has
  // something to resolve — this route also allows the certificate's own
  // recipient regardless of role, which CertificatesService checks itself.
  @Get("events/:eventId/certificates/:certificateId")
  async download(
    @Param("certificateId") certificateId: string,
    @CurrentUser() currentUser: CurrentUserType,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const cert = await this.certificates.getCertificate(certificateId, currentUser);
    res.header("Content-Type", "application/pdf");
    res.header("Content-Disposition", `attachment; filename="certificate-${certificateId}.pdf"`);
    return new StreamableFile(createReadStream(join(CERTIFICATES_DIR, cert.pdfObjectKey!)));
  }

  @Get("verify/judge-record/:recordId")
  @Public()
  verify(@Param("recordId") recordId: string) {
    return this.certificates.verifyJudgeRecord(recordId);
  }

  @Get("users/me/certificates")
  findMine(@CurrentUser() user: CurrentUserType) {
    return this.certificates.findMineForUser(user.id);
  }
}
