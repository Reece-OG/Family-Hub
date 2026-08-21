import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { readPhoto } from "@/lib/photo-storage";

// Serves the raw image bytes. Wrapped in the same auth layer as everything
// else, so photos aren't exposed publicly even though the `uploads` volume is
// mounted in the container.
export async function GET(
  _req: NextRequest,
  { params }: { params: { filename: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewPhotos")) {
      throw new HttpError(403, "No permission to view photos");
    }
    // Basic traversal guard: must match the format we create in photo-storage.
    if (!/^[0-9a-z-]+\.[a-z0-9]+$/i.test(params.filename)) {
      throw new HttpError(400, "Bad filename");
    }
    const photo = await prisma.photo.findUnique({
      where: { filename: params.filename },
    });
    if (!photo) throw new HttpError(404, "Photo not found");
    const buf = await readPhoto(params.filename);
    if (!buf) throw new HttpError(404, "Photo missing on disk");

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": photo.mimeType,
        "Content-Length": buf.length.toString(),
        "Cache-Control": "private, max-age=604800",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
