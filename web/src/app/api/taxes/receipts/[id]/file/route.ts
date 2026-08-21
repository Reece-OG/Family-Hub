import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import {
  ALLOWED_RECEIPT_MIME,
  MAX_RECEIPT_BYTES,
  deleteReceipt,
  extFromReceiptMime,
  makeSafeReceiptFilename,
  readReceipt,
  saveReceipt,
} from "@/lib/receipt-storage";

async function loadOwned(ownerId: string, id: string) {
  const r = await prisma.taxReceipt.findUnique({ where: { id } });
  if (!r || r.ownerId !== ownerId) {
    throw new HttpError(404, "Receipt not found");
  }
  return r;
}

// GET /api/taxes/receipts/[id]/file
// Streams the original receipt file, after re-checking that the caller owns
// the receipt. Cached on the client only — we never want a public CDN to see
// somebody else's invoice.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    const r = await loadOwned(me.id, params.id);
    if (!r.fileFilename || !r.fileMimeType) {
      throw new HttpError(404, "No file attached");
    }
    const buf = await readReceipt(r.fileFilename);
    if (!buf) throw new HttpError(404, "File missing on disk");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": r.fileMimeType,
        "Content-Length": buf.length.toString(),
        "Cache-Control": "private, max-age=86400",
        // Prefer inline so PDFs preview in the browser; the UI also offers a
        // "download" anchor when the user wants the bytes.
        "Content-Disposition": "inline",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

// POST: replaces the attached file (if any) with the uploaded one.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    const r = await loadOwned(me.id, params.id);

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Missing file");
    if (file.size === 0) throw new HttpError(400, "Empty file");
    if (file.size > MAX_RECEIPT_BYTES) {
      throw new HttpError(
        400,
        `File exceeds ${Math.floor(MAX_RECEIPT_BYTES / 1024 / 1024)} MB limit`,
      );
    }
    if (!ALLOWED_RECEIPT_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported file type: ${file.type}`);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const filename = makeSafeReceiptFilename(extFromReceiptMime(file.type));
    await saveReceipt(buf, filename);

    // Best-effort cleanup of any prior file. If the unlink fails (e.g.
    // already gone), the helper swallows ENOENT.
    if (r.fileFilename && r.fileFilename !== filename) {
      await deleteReceipt(r.fileFilename);
    }

    const receipt = await prisma.taxReceipt.update({
      where: { id: params.id },
      data: {
        fileFilename: filename,
        fileMimeType: file.type,
        fileSizeBytes: file.size,
      },
    });
    return NextResponse.json({ receipt });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    const r = await loadOwned(me.id, params.id);
    if (r.fileFilename) {
      await deleteReceipt(r.fileFilename);
    }
    const receipt = await prisma.taxReceipt.update({
      where: { id: params.id },
      data: { fileFilename: null, fileMimeType: null, fileSizeBytes: null },
    });
    return NextResponse.json({ receipt });
  } catch (e) {
    return handleError(e);
  }
}
