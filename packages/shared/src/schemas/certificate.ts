import { z } from "zod";

export const CertificateType = z.enum(["participation", "winner", "judge"]);
export type CertificateType = z.infer<typeof CertificateType>;

// FR-CERT-01
export const GenerateCertificatesInput = z.object({
  type: CertificateType,
  recipientIds: z.array(z.string()).min(1),
});
export type GenerateCertificatesInput = z.infer<typeof GenerateCertificatesInput>;
