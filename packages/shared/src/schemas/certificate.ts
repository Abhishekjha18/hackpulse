import { z } from "zod";

import { CERTIFICATE_TYPE } from "../constants";

export const CertificateType = z.enum([
  CERTIFICATE_TYPE.PARTICIPATION,
  CERTIFICATE_TYPE.WINNER,
  CERTIFICATE_TYPE.JUDGE,
]);
export type CertificateType = z.infer<typeof CertificateType>;

// FR-CERT-01
export const GenerateCertificatesInput = z.object({
  type: CertificateType,
  recipientIds: z.array(z.string()).min(1),
});
export type GenerateCertificatesInput = z.infer<typeof GenerateCertificatesInput>;
