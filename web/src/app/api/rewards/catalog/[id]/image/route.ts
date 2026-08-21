import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import {
  ALLOWED_REWARD_IMAGE_MIME,
  MAX_REWARD_IMAGE_BYTES,
  deleteRewardImage,
  extFromRewardImageMime,
  makeSafeRewardImageFilename,
  readRewardImage,
  saveRewardImage,
} from "@/lib/reward-images";

// GET /api/rewards/catalog/[id]/image — streams the bytes. Anyone signed in
// can fetch; the catalogue is family-shared and there's nothing private
// in a treat photo.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser();
    const item = await prisma.rewardItem.findUnique({
      where: { id: params.id },
    });
    if (!item || !item.imageFilename || !item.imageMimeType) {
      throw new HttpError(404, "No image attached");
    }
    const buf = await readRewardImage(item.imageFilename);
    if (!buf) throw new HttpError(404, "Image missing on disk");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": item.imageMimeType,
        "Content-Length": buf.length.toString(),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can upload reward images");
    }
    const item = await prisma.rewardItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Reward not found");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file");
    if (file.size === 0) throw new HttpError(400, "Empty file");
    if (file.size > MAX_REWARD_IMAGE_BYTES) {
      throw new HttpError(
        400,
        `File exceeds ${Math.floor(MAX_REWARD_IMAGE_BYTES / 1024 / 1024)} MB limit`,
      );
    }
    if (!ALLOWED_REWARD_IMAGE_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported image type: ${file.type}`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const filename = makeSafeRewardImageFilename(file.type);
    await saveRewardImage(buf, filename);
    if (item.imageFilename && item.imageFilename !== filename) {
      await deleteRewardImage(item.imageFilename);
    }
    void extFromRewardImageMime; // imported for symmetry / future use
    const updated = await prisma.rewardItem.update({
      where: { id: params.id },
      data: {
        imageFilename: filename,
        imageMimeType: file.type,
      },
    });
    return NextResponse.json({ item: updated });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can remove reward images");
    }
    const item = await prisma.rewardItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Reward not found");
    if (item.imageFilename) {
      await deleteRewardImage(item.imageFilename);
    }
    const updated = await prisma.rewardItem.update({
      where: { id: params.id },
      data: { imageFilename: null, imageMimeType: null },
    });
    return NextResponse.json({ item: updated });
  } catch (e) {
    return handleError(e);
  }
}
