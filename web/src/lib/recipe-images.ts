// Helper for storing recipe photos on the shared `uploads` Docker volume.
// Files live at /app/uploads/recipe-images/<filename>. Only the bare filename
// is stored on the Recipe row (`imageFilename`).
//
// Mirrors lib/maintenance-docs.ts, but trimmed to image MIME types only —
// there's no reason to accept a PDF as a recipe hero image.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const IMAGES_DIR = path.join(UPLOADS_DIR, "recipe-images");

export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function ensureImagesDir() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

export function imagePath(filename: string) {
  return path.join(IMAGES_DIR, filename);
}

export async function saveImage(buf: Buffer, filename: string): Promise<void> {
  await ensureImagesDir();
  await fs.writeFile(imagePath(filename), buf);
}

export async function deleteImage(filename: string): Promise<void> {
  try {
    await fs.unlink(imagePath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readImage(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(imagePath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export function extFromImageMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function contentTypeFromExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

export function makeSafeImageFilename(mime: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const ext = extFromImageMime(mime);
  return `${ts}-${rand}.${ext}`;
}
