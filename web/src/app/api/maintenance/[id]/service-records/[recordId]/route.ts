import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { refreshMaintenanceSchedule } from "@/lib/maintenance";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; recordId: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }

    const record = await prisma.serviceRecord.findUnique({
      where: { id: params.recordId },
    });
    if (!record || record.itemId !== params.id) {
      throw new HttpError(404, "Service record not found");
    }

    await prisma.serviceRecord.delete({ where: { id: params.recordId } });
    // After deleting, the "last service" may have changed — resync.
    const item = await refreshMaintenanceSchedule(params.id);

    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return handleError(e);
  }
}
