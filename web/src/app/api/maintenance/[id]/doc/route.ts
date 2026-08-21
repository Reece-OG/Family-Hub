import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import {
  ALLOWED_DOC_MIME,
  deleteDoc,
  makeSafeDocFilename,
  readDoc,
  saveDoc,
} from "@/lib/maintenance-docs";

// Documents up to 10 MB. That's enough for a multi-page PDF scan without
// encouraging people to dump giant scans here.
const MAX_BYTES = 10 * 1024 * 1024;

type Kind = "registration" | "insurance";

function kindFromReq(req: NextRequest): Kind {
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "registration" && kind !== "insurance") {
    throw new HttpError(400, "kind must be 'registration' or 'insurance'");
  }
  return kind;
}

function filenameField(kind: Kind): "registrationDocFilename" | "insuranceDocFilename" {
  return kind === "registration"
    ? "registrationDocFilename"
    : "insuranceDocFilename";
}

// POST /api/maintenance/[id]/doc?kind=registration|insurance
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }
    const kind = kindFromReq(req);
    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file");
    if (file.size === 0) throw new HttpError(400, "Empty file");
    if (file.size > MAX_BYTES) {
      throw new HttpError(
        400,
        `File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit`,
      );
    }
    if (!ALLOWED_DOC_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported document type: ${file.type}`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const filename = makeSafeDocFilename(file.type);
    await saveDoc(buf, filename);

    // Remove the previous file if we replaced it — avoids stale files on disk.
    const field = filenameField(kind);
    const previous = (item as any)[field] as string | null;
    if (previous && previous !== filename) {
      await deleteDoc(previous).catch(() => {});
    }

    const updated = await prisma.maintenanceItem.update({
      where: { id: params.id },
      data: { [field]: filename },
    });
    return NextResponse.json({
      ok: true,
      filename,
      item: updated,
    });
  } catch (e) {
    return handleError(e);
  }
}

// GET /api/maintenance/[id]/doc?kind=registration|insurance — streams the file.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMaintenance")) {
      throw new HttpError(403, "No permission to view maintenance");
    }
    const kind = kindFromReq(req);
    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");
    const field = filenameField(kind);
    const filename = (item as any)[field] as string | null;
    if (!filename) throw new HttpError(404, "No document uploaded");
    const buf = await readDoc(filename);
    if (!buf) throw new HttpError(404, "File missing on disk");

    const ext = filename.split(".").pop() || "";
    const contentType =
      ext === "pdf"
        ? "application/pdf"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : "application/octet-stream";
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${kind}-${item.name.replace(/[^a-z0-9-_]/gi, "_")}.${ext}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// DELETE /api/maintenance/[id]/doc?kind=registration|insurance — removes the
// file from disk and clears the filename column.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }
    const kind = kindFromReq(req);
    const field = filenameField(kind);
    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");
    const filename = (item as any)[field] as string | null;
    if (filename) await deleteDoc(filename).catch(() => {});
    const updated = await prisma.maintenanceItem.update({
      where: { id: params.id },
      data: { [field]: null },
    });
    return NextResponse.json({ ok: true, item: updated });
  } catch (e) {
    return handleError(e);
  }
}
