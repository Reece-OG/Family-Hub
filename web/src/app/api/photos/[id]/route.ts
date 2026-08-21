import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { deletePhoto } from "@/lib/photo-storage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManagePhotos")) {
      throw new HttpError(403, "No permission to delete photos");
    }
    const photo = await prisma.photo.findUnique({ where: { id: params.id } });
    if (!photo) throw new HttpError(404, "Photo not found");
    await prisma.photo.delete({ where: { id: params.id } });
    await deletePhoto(photo.filename).catch((err) =>
      console.warn("[photos] failed to delete file on disk:", err),
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
