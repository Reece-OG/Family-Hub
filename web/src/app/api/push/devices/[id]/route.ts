import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/push/devices/[id]
//
// Removes a specific enrolment owned by the current user. The Settings
// UI uses this when the user clicks "Remove" next to one of their
// devices. Idempotent — already-deleted rows return 200.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    const sub = await prisma.pushSubscription.findUnique({
      where: { id: params.id },
    });
    if (!sub) return NextResponse.json({ ok: true });
    if (sub.userId !== me.id) {
      throw new HttpError(404, "Not found");
    }
    await prisma.pushSubscription.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
