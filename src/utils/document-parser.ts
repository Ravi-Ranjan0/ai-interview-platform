import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export async function parseDocument(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<{ text: string }> {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(fileBuffer) });
    const data = await parser.getText();
    return { text: data.text || "" };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return { text: result.value };
  }

  if (
    mimeType.startsWith("text/") ||
    fileName.toLowerCase().endsWith(".txt") ||
    fileName.toLowerCase().endsWith(".md") ||
    fileName.toLowerCase().endsWith(".csv")
  ) {
    return { text: fileBuffer.toString("utf-8") };
  }

  throw new Error(`Unsupported document type. MIME: ${mimeType}, File: ${fileName}`);
}
