import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { getVersionInfo, isUpdaterAvailable } from "@/lib/system-updates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireParent();
    const available = await isUpdaterAvailable();
    const version = await getVersionInfo();
    return NextResponse.json({
      updaterAvailable: available,
      version,
    });
  } catch (e) {
    return handleError(e);
  }
}
