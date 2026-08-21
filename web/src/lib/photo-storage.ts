// Helper for reading/writing photo files on the shared `uploads` Docker volume.
// Files live at /app/uploads/photos/<filename>. Only the bare filename is
// stored in the Photo table.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const PHOTOS_DIR = path.join(UPLOADS_DIR, "photos");

// v4.9.3 — HEIC + HEIF added so iPhone uploads (the default camera
// format unless the user switched to "Most Compatible") aren't silently
// rejected by the API. Storage is byte-for-byte preserving — we don't
// transcode. Browsers that can't render HEIC inline (Chrome, Firefox)
// will show a broken-image icon, but the file is on disk and can be
// downloaded or re-served from a Safari device. A future enhancement
// could add a client-side HEIC→JPEG conversion before upload.
export const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export async function ensurePhotosDir() {
  await fs.mkdir(PHOTOS_DIR, { recursive: true });
}

export function photoPath(filename: string) {
  return path.join(PHOTOS_DIR, filename);
}

export async function savePhoto(
  buffer: Buffer,
  filename: string,
): Promise<void> {
  await ensurePhotosDir();
  await fs.writeFile(photoPath(filename), buffer);
}

export async function deletePhoto(filename: string): Promise<void> {
  try {
    await fs.unlink(photoPath(filename));
  } catch (err) {
    // If the file is already gone, that's fine.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readPhoto(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(photoPath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

// Safe filename generator — preserves extension, drops directory traversal.
export function makeSafeFilename(originalName: string, ext: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const cleanExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${ts}-${rand}.${cleanExt}`;
  // (originalName is intentionally unused — we don't trust it for on-disk
  // filenames, but keep the param so callers can log / store it if desired.)
  void originalName;
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "bin";
  }
}
