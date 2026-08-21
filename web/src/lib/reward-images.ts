// Helper for storing reward catalogue images on the shared `uploads` Docker
// volume. Files live at /app/uploads/reward-images/<filename>. Only the
// bare filename is stored on the RewardItem row (`imageFilename`).
//
// Mirrors lib/recipe-images.ts. JPEG/PNG/WebP/GIF — no PDFs.

import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");
const IMAGES_DIR = path.join(UPLOADS_DIR, "reward-images");

export const ALLOWED_REWARD_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const MAX_REWARD_IMAGE_BYTES = 6 * 1024 * 1024;

export async function ensureRewardImagesDir() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

export function rewardImagePath(filename: string) {
  return path.join(IMAGES_DIR, filename);
}

export async function saveRewardImage(
  buf: Buffer,
  filename: string,
): Promise<void> {
  await ensureRewardImagesDir();
  await fs.writeFile(rewardImagePath(filename), buf);
}

export async function deleteRewardImage(filename: string): Promise<void> {
  try {
    await fs.unlink(rewardImagePath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}

export async function readRewardImage(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(rewardImagePath(filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export function extFromRewardImageMime(mime: string): string {
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

export function makeSafeRewardImageFilename(mime: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now();
  const ext = extFromRewardImageMime(mime);
  return `${ts}-${rand}.${ext}`;
}
