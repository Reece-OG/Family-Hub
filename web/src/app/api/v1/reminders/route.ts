// v4.9.0 — public REST: GET /api/v1/reminders
//
// Returns scheduled reminders. By default only unsent reminders are
// returned; pass ?include_sent=1 to include history.
//   ?user_id=<uid>      filter to a single recipient
//   ?from / ?to         filter remind_at to a window
//   ?limit=<n>          cap 500, default 200
//
// Authn via Authorization: Bearer <token> with scope "reminders:read".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiToken } from "@/lib/api-auth";
import { handleError } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    await requireApiToken(req, "reminders:read");

    const url = new URL(req.url);
    const includeSent = url.searchParams.get("include_sent") === "1";
    const userId = url.searchParams.get("user_id");
    const fromStr = url.searchParams.get("from");
    const toStr = url.searchParams.get("to");
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(500, Math.floor(limitParam))
        : 200;

    const where: {
      sent?: boolean;
      userId?: string;
      remindAt?: { gte?: Date; lte?: Date };
    } = {};
    if (!includeSent) where.sent = false;
    if (userId) where.userId = userId;
    if (fromStr || toStr) {
      where.remindAt = {};
      if (fromStr) {
        const d = new Date(fromStr);
        if (!isNaN(d.getTime())) where.remindAt.gte = d;
      }
      if (toStr) {
        const d = new Date(toStr);
        if (!isNaN(d.getTime())) where.remindAt.lte = d;
      }
    }

    const rows = await prisma.reminder.findMany({
      where,
      take: limit,
      orderBy: { remindAt: "asc" },
      include: { user: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      count: rows.length,
      reminders: rows.map((r) => ({
        id: r.id,
        user_id: r.userId,
        user_name: r.user?.name ?? null,
        title: r.title,
        body: r.body,
        remind_at: r.remindAt.toISOString(),
        sent: r.sent,
        sent_at: r.sentAt?.toISOString() ?? null,
        delivery_in_app: r.deliveryInApp,
        delivery_email: r.deliveryEmail,
        source_event_reminder_id: r.sourceEventReminderId,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
