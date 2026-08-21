import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

// POST /api/rewards/redemptions/[id]/fulfill
//
// Parent action: marks a PENDING redemption as FULFILLED — the points
// have already been deducted at redemption time, so this is a status
// flip plus an audit stamp (when, by whom). No-op on rows that are
// already fulfilled; rejects cancelled rows.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can fulfil redemptions");
    }
    const existing = await prisma.rewardRedemption.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Redemption not found");
    if (existing.status === "CANCELLED") {
      throw new HttpError(409, "Redemption was cancelled");
    }
    const redemption = await prisma.rewardRedemption.update({
      where: { id: params.id },
      data: {
        status: "FULFILLED",
        fulfilledAt: new Date(),
        fulfilledById: me.id,
        actorUserId: me.id,
      },
      include: {
        child: { select: { id: true, name: true, color: true, avatarEmoji: true } },
        rewardItem: {
          select: { id: true, name: true, imageFilename: true, costPoints: true },
        },
        actor: { select: { id: true, name: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ redemption });
  } catch (e) {
    return handleError(e);
  }
}
