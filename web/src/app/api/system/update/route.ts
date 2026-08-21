import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { requestUpdate } from "@/lib/system-updates";

export const dynamic = "force-dynamic";

/**
 * Touches /var/lib/family-hub/state/update-requested, which fires the
 * family-hub-update.path systemd unit on the LXC host. The actual pull +
 * rebuild happens out-of-band; the caller polls GET /api/system/update/status
 * to watch the running / success / failed state.
 */
export async function POST() {
  try {
    await requireParent();
    await requestUpdate();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
