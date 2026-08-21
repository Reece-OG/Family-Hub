import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { requestCheck } from "@/lib/system-updates";

export const dynamic = "force-dynamic";

/**
 * Touches /var/lib/family-hub/state/check-requested, which fires the
 * family-hub-check.path systemd unit on the LXC host. The check itself is
 * asynchronous — the caller polls GET /api/system/version for the result.
 */
export async function POST() {
  try {
    await requireParent();
    await requestCheck();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
