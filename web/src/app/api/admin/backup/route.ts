import { NextResponse } from "next/server";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { collectBackup } from "@/lib/backup";

// Runs in Node (we need adm-zip + filesystem access).
export const runtime = "nodejs";
// The export reads every model in one go and packs files into a zip — at
// the size families generate this is well under any reasonable timeout,
// but we mark it dynamic so Next.js doesn't try to cache the response.
export const dynamic = "force-dynamic";

// GET /api/admin/backup
//
// Streams a single .zip to the caller containing manifest + data.json +
// every uploaded file (photos, recipe images, receipts, reward images,
// maintenance docs). Parent-only.
export async function GET() {
  try {
    const me = await requireParent();
    // Deliberately read package.json at request time so the manifest
    // always carries the running app version, even after an in-app
    // update flips it.
    let appVersion = "unknown";
    try {
      // Dynamic import keeps it out of the client bundle.
      const pkg = await import("../../../../../package.json");
      appVersion = (pkg as { version?: string }).version ?? "unknown";
    } catch {
      // Best-effort; the backup is still valid without the version.
    }
    const buf = await collectBackup({
      actorId: me.id,
      actorName: me.name,
      appVersion,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `family-hub-backup-${stamp}.zip`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
