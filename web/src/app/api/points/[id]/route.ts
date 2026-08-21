import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

// Allow parents to delete a points entry (e.g. awarded in error).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT" || !can(me, "canManageRewards")) {
      throw new HttpError(403, "Only parents can remove points entries");
    }
    const entry = await prisma.pointsTransaction.findUnique({
      where: { id: params.id },
    });
    if (!entry) throw new HttpError(404, "Entry not found");
    await prisma.pointsTransaction.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
