import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

export interface CertificateContent {
  title: string;
  recipientName: string;
  eventName: string;
  issuedAt: Date;
  verifyUrl?: string;
}

/** A deliberately simple, single-page certificate — this is a hackathon
 * utility, not a design system. The QR code (when present) is what makes a
 * printed judge certificate independently verifiable (FR-CERT-02). */
export async function renderCertificatePdf(content: CertificateContent): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // A4 landscape, points
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const { width, height } = page.getSize();
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: rgb(0.2, 0.2, 0.3),
    borderWidth: 2,
  });

  page.drawText(content.title, {
    x: 60,
    y: height - 120,
    size: 32,
    font: bold,
    color: rgb(0.1, 0.1, 0.2),
  });
  page.drawText(content.recipientName, {
    x: 60,
    y: height - 200,
    size: 24,
    font: bold,
  });
  page.drawText(`for ${content.eventName}`, {
    x: 60,
    y: height - 240,
    size: 16,
    font: regular,
  });
  page.drawText(`Issued ${content.issuedAt.toISOString().slice(0, 10)}`, {
    x: 60,
    y: height - 270,
    size: 12,
    font: regular,
    color: rgb(0.4, 0.4, 0.4),
  });

  if (content.verifyUrl) {
    const qrPng = await QRCode.toBuffer(content.verifyUrl, { type: "png", margin: 1, width: 160 });
    const qrImage = await pdfDoc.embedPng(qrPng);
    page.drawImage(qrImage, { x: width - 220, y: 60, width: 140, height: 140 });
    page.drawText("Scan to verify", {
      x: width - 220,
      y: 45,
      size: 10,
      font: regular,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  return pdfDoc.save();
}
