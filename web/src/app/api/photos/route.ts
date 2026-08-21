import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import {
  ALLOWED_PHOTO_MIME,
  extFromMime,
  makeSafeFilename,
  savePhoto,
} from "@/lib/photo-storage";

// Photos can be reasonably large; default 10 MB max per upload.
const MAX_BYTES = 10 * 1024 * 1024;

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewPhotos")) {
      throw new HttpError(403, "No permission to view photos");
    }
    const photos = await prisma.photo.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { id: true, name: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ photos });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canManagePhotos")) {
      throw new HttpError(403, "No permission to upload photos");
    }
    const form = await req.formData();
    const file = form.get("file");
    const caption = (form.get("caption") as string | null) ?? null;
    if (!(file instanceof File)) {
      throw new HttpError(400, "Missing file");
    }
    if (file.size === 0) throw new HttpError(400, "Empty file");
    if (file.size > MAX_BYTES) {
      throw new HttpError(400, `File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit`);
    }
    if (!ALLOWED_PHOTO_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported image type: ${file.type}`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const filename = makeSafeFilename(file.name, extFromMime(file.type));
    await savePhoto(buf, filename);

    const photo = await prisma.photo.create({
      data: {
        filename,
        caption,
        uploadedById: me.id,
        mimeType: file.type,
        sizeBytes: file.size,
      },
      include: {
        uploadedBy: { select: { id: true, name: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ photo });
  } catch (e) {
    return handleError(e);
  }
}
