import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { getUpdateStatus, isUpdaterAvailable } from "@/lib/system-updates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireParent();
    const available = await isUpdaterAvailable();
    const status = await getUpdateStatus();
    return NextResponse.json({
      updaterAvailable: available,
      status,
    });
  } catch (e) {
    return handleError(e);
  }
}
