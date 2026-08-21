import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

// POST /api/rewards/redemptions/[id]/cancel
//
// Parent action: cancels a PENDING redemption. Refunds the original cost
// via a positive PointsTransaction (so the kid's balance returns to what
// it was) and links it on the row via refundTransactionId. Rejects rows
// that are already FULFILLED — once a parent's marked it delivered we
// don't unwind the points automatically; that's a manual deduct via the
// existing parent UI if needed.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can cancel redemptions");
    }
    const existing = await prisma.rewardRedemption.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Redemption not found");
    if (existing.status === "FULFILLED") {
      throw new HttpError(
        409,
        "Already fulfilled — adjust the points manually if needed",
      );
    }
    if (existing.status === "CANCELLED") {
      throw new HttpError(409, "Already cancelled");
    }

    const redemption = await prisma.$transaction(async (tx) => {
      const refund = await tx.pointsTransaction.create({
        data: {
          childId: existing.childId,
          awardedById: me.id,
          points: existing.costPoints,
          reason: `Refund: ${existing.itemName}`,
        },
      });
      return tx.rewardRedemption.update({
        where: { id: params.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledById: me.id,
          actorUserId: me.id,
          refundTransactionId: refund.id,
        },
        include: {
          child: { select: { id: true, name: true, color: true, avatarEmoji: true } },
          rewardItem: {
            select: { id: true, name: true, imageFilename: true, costPoints: true },
          },
          actor: { select: { id: true, name: true, avatarEmoji: true } },
        },
      });
    });

    return NextResponse.json({ redemption });
  } catch (e) {
    return handleError(e);
  }
}
