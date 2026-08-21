// Helper for storing maintenance-related PDFs and images (registration &
// insurance documents) on the shared `uploads` Docker volume. Files live at
// /app/uploads/maintenance-docs/<filename>. Only the bare filename is
// stored on the MaintenanceItem record.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const DOCS_DIR = path.join(UPLOADS_DIR, "maintenance-docs");

// Registration certificates and insurance schedules are usually PDFs, but we
// also accept the common image types so users can snap a photo.
export const ALLOWED_DOC_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function ensureDocsDir() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

export function docPath(filename: string) {
  return path.join(DOCS_DIR, filename);
}

export async function saveDoc(buf: Buffer, filename: string): Promise<void> {
  await ensureDocsDir();
  await fs.writeFile(docPath(filename), buf);
}

export async function deleteDoc(filename: string): Promise<void> {
  try {
    await fs.unlink(docPath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readDoc(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(docPath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export function extFromDocMime(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

export function makeSafeDocFilename(mime: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const ext = extFromDocMime(mime);
  return `${ts}-${rand}.${ext}`;
}
