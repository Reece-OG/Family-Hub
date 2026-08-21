import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { sendTestPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/push/test
//
// Sends a single test notification to every subscription belonging to
// the current user. Used by the Settings "Send test" button so users can
// verify push is wired up end-to-end without waiting for a real reminder.
export async function POST() {
  try {
    const me = await requireUser();
    const result = await sendTestPushToUser(me.id);
    return NextResponse.json({ result });
  } catch (e) {
    return handleError(e);
  }
}
