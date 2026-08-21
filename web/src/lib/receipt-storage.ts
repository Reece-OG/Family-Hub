// Helper for reading/writing tax-receipt files on the shared `uploads`
// Docker volume. Files live at /app/uploads/receipts/<filename>. Only the
// bare filename is stored in the TaxReceipt table — the API layer enforces
// per-user ownership before serving any file.
//
// Mirrors photo-storage.ts so the operational story (volumes, permissions,
// snapshots) is uniform across every uploaded artefact.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const RECEIPTS_DIR = path.join(UPLOADS_DIR, "receipts");

export const ALLOWED_RECEIPT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

// 12 MB cap. PDFs can be chunky — generous enough for a multi-page invoice
// but small enough that nothing pathological lands on the volume.
export const MAX_RECEIPT_BYTES = 12 * 1024 * 1024;

export async function ensureReceiptsDir() {
  await fs.mkdir(RECEIPTS_DIR, { recursive: true });
}

export function receiptPath(filename: string) {
  return path.join(RECEIPTS_DIR, filename);
}

export async function saveReceipt(
  buffer: Buffer,
  filename: string,
): Promise<void> {
  await ensureReceiptsDir();
  await fs.writeFile(receiptPath(filename), buffer);
}

export async function deleteReceipt(filename: string): Promise<void> {
  try {
    await fs.unlink(receiptPath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readReceipt(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(receiptPath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export function makeSafeReceiptFilename(ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const cleanExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${ts}-${rand}.${cleanExt}`;
}

export function extFromReceiptMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}
