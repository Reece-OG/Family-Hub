import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

// Called by the client's ReminderToaster every ~30s.
// Returns any of the current user's reminders that have fired (sent=true)
// but haven't been acknowledged yet.
export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewReminders")) {
      throw new HttpError(403, "No permission to view reminders");
    }
    const due = await prisma.reminder.findMany({
      where: {
        userId: me.id,
        sent: true,
        acknowledgedAt: null,
      },
      orderBy: { remindAt: "asc" },
      take: 10,
    });
    return NextResponse.json({ reminders: due });
  } catch (e) {
    return handleError(e);
  }
}
