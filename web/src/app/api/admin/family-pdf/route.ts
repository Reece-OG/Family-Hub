import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { buildFamilyPdf } from "@/lib/family-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/family-pdf
//
// Builds a single PDF that contains every family-facing thing in the app
// (members, calendar, birthdays, todos, shopping, menu, recipes, photos,
// reminders, points ledger, redemptions, maintenance log, tax records).
// AppSettings are intentionally NOT included — this is the document the
// family takes when leaving, not a backup. Parent-only.
export async function GET() {
  try {
    const me = await requireParent();
    const buf = await buildFamilyPdf({ exportedByName: me.name });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `family-hub-export-${stamp}.pdf`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
