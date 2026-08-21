import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { getVapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/push/vapid-key
//
// Returns the family's VAPID public key. The first call after a fresh
// install lazily generates the key pair and stores it on AppSettings —
// subsequent calls just read it. Any signed-in user is allowed; the key
// is public and the client needs it to call pushManager.subscribe().
export async function GET() {
  try {
    await requireUser();
    const publicKey = await getVapidPublicKey();
    return NextResponse.json({ publicKey });
  } catch (e) {
    return handleError(e);
  }
}
