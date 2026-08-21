import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  // Free-text label — the User-Agent at enrol time so the user can pick
  // their phone out of a list later.
  userAgent: z.string().max(500).optional().nullable(),
});

// POST /api/push/subscribe
//
// Saves (or refreshes) a Web Push enrolment for the current user. The
// browser hands us back the same endpoint URL on re-subscribe, so we
// upsert on `endpoint` to keep the row count stable across re-installs.
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const input = subscribeSchema.parse(await req.json());

    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: {
        userId: me.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
        // Reset error state on a fresh subscribe so the device list shows
        // it as healthy again.
        lastError: null,
      },
      create: {
        userId: me.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
    });

    return NextResponse.json({
      subscription: {
        id: sub.id,
        userAgent: sub.userAgent,
        createdAt: sub.createdAt,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}

// DELETE /api/push/subscribe?endpoint=...
//
// Removes the subscription matching this endpoint. Used by the client
// when the user toggles push off in Settings (or clicks "Remove").
export async function DELETE(req: NextRequest) {
  try {
    const me = await requireUser();
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) throw new HttpError(400, "endpoint is required");
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    if (!existing) return NextResponse.json({ ok: true });
    if (existing.userId !== me.id) {
      // Pretend success rather than leaking that some other user owns it.
      return NextResponse.json({ ok: true });
    }
    await prisma.pushSubscription.delete({ where: { endpoint } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
