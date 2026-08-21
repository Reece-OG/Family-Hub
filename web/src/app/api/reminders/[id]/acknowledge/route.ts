import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

// Dismiss the in-app toast for a fired reminder. Only the target user can
// acknowledge their own reminders.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    const r = await prisma.reminder.findUnique({ where: { id: params.id } });
    if (!r) throw new HttpError(404, "Reminder not found");
    if (r.userId !== me.id) throw new HttpError(403, "Not yours to acknowledge");
    await prisma.reminder.update({
      where: { id: params.id },
      data: { acknowledgedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
