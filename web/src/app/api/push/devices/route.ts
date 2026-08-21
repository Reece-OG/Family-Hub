import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/push/devices
//
// Returns the current user's push enrolments — what the Settings UI
// renders as "Notification devices". Each row is one browser/device the
// user has approved. Fields shipped to the client are intentionally
// trimmed: no endpoint URL or encryption keys.
export async function GET() {
  try {
    const me = await requireUser();
    const subs = await prisma.pushSubscription.findMany({
      where: { userId: me.id },
      orderBy: [{ lastSuccessAt: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({
      devices: subs.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSuccessAt: s.lastSuccessAt,
        lastFailureAt: s.lastFailureAt,
        lastError: s.lastError,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
