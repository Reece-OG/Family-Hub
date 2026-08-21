import { NextRequest, NextResponse } from "next/server";
import { requireParent, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { restoreBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 250 MB cap — generous given the average Family Hub install but small
// enough to stop a pathological upload. Tune via FAMILYHUB_RESTORE_MAX_MB
// if a particular family really has gigabytes of photos.
function maxBytes(): number {
  const raw = Number(process.env.FAMILYHUB_RESTORE_MAX_MB);
  if (!Number.isFinite(raw) || raw <= 0) return 250 * 1024 * 1024;
  return Math.floor(raw) * 1024 * 1024;
}

// POST /api/admin/restore
//
// Wipes the database (every family-data table) and re-inserts the
// contents of the uploaded backup zip, plus restores every uploaded
// file. Parent-only. Returns row counts so the UI can confirm success.
//
// IMPORTANT: this is destructive. The route does NOT do a second confirm
// itself — it relies on the client to have already collected an explicit
// "yes wipe and replace" before POSTing.
export async function POST(req: NextRequest) {
  try {
    await requireParent();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new HttpError(400, "Missing file (form field 'file')");
    }
    if (file.size === 0) throw new HttpError(400, "Empty file");
    const cap = maxBytes();
    if (file.size > cap) {
      throw new HttpError(
        400,
        `Backup exceeds ${Math.floor(cap / 1024 / 1024)} MB limit`,
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await restoreBackup(buf);
    return NextResponse.json({
      manifest: result.manifest,
      inserted: result.inserted,
    });
  } catch (e) {
    return handleError(e);
  }
}
