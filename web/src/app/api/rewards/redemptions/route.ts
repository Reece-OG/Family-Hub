import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

const redemptionInclude = {
  child: { select: { id: true, name: true, color: true, avatarEmoji: true } },
  rewardItem: {
    select: { id: true, name: true, imageFilename: true, costPoints: true },
  },
  actor: { select: { id: true, name: true, avatarEmoji: true } },
} as const;

// GET /api/rewards/redemptions
//
// Visibility rules:
//   • PARENT  -> all redemptions in the family. Optional ?status= filter
//                ("pending" | "fulfilled" | "cancelled" | "all", defaults
//                to "all"). Used to populate both the Ready-to-Fulfil
//                queue and the family ledger.
//   • CHILD   -> only their own redemption history.
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const url = new URL(req.url);
    const statusRaw = (url.searchParams.get("status") ?? "all").toLowerCase();
    const allowed = new Set(["pending", "fulfilled", "cancelled", "all"]);
    if (!allowed.has(statusRaw)) {
      throw new HttpError(400, "Invalid status filter");
    }
    const where: Record<string, unknown> = {};
    if (me.role !== "PARENT") {
      where.childId = me.id;
    }
    if (statusRaw !== "all") {
      where.status = statusRaw.toUpperCase();
    }
    const redemptions = await prisma.rewardRedemption.findMany({
      where,
      include: redemptionInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    return NextResponse.json({ redemptions });
  } catch (e) {
    return handleError(e);
  }
}

const createSchema = z.object({
  rewardItemId: z.string(),
  // Parents may redeem on behalf of a child (e.g. they handed over the
  // reward in person and want to record it). Only used when role===PARENT.
  childId: z.string().optional(),
});

// Compute a child's current points balance — sum of every transaction
// linked to them. Same shape as the existing parent ledger query.
async function balanceFor(childId: string): Promise<number> {
  const agg = await prisma.pointsTransaction.aggregate({
    where: { childId },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

// POST /api/rewards/redemptions
//
// Children can only redeem for themselves. Parents can redeem on a child's
// behalf by passing childId. We deduct points immediately (so a kid can't
// double-spend by tapping fast) and create a PENDING row that the parent
// later flips to FULFILLED via the /[id]/fulfill route — or refunds via
// /[id]/cancel.
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const input = createSchema.parse(await req.json());

    let targetChildId = me.id;
    if (input.childId && input.childId !== me.id) {
      if (me.role !== "PARENT") {
        throw new HttpError(403, "Only parents can redeem on behalf of others");
      }
      targetChildId = input.childId;
    }
    const child = await prisma.user.findUnique({
      where: { id: targetChildId },
    });
    if (!child) throw new HttpError(400, "Child not found");
    if (child.role !== "CHILD") {
      throw new HttpError(400, "Rewards are only redeemable by children");
    }

    const item = await prisma.rewardItem.findUnique({
      where: { id: input.rewardItemId },
    });
    if (!item) throw new HttpError(404, "Reward not found");
    if (!item.available) {
      throw new HttpError(400, "Reward is not currently available");
    }

    const balance = await balanceFor(targetChildId);
    if (balance < item.costPoints) {
      throw new HttpError(
        400,
        `Not enough points (have ${balance}, need ${item.costPoints})`,
      );
    }

    // Atomic: deduct + create redemption row pointing at the deduct txn.
    const redemption = await prisma.$transaction(async (tx) => {
      const txn = await tx.pointsTransaction.create({
        data: {
          childId: targetChildId,
          awardedById: me.id,
          points: -item.costPoints,
          reason: `Redeemed: ${item.name}`,
        },
      });
      return tx.rewardRedemption.create({
        data: {
          childId: targetChildId,
          rewardItemId: item.id,
          itemName: item.name,
          costPoints: item.costPoints,
          status: "PENDING",
          deductTransactionId: txn.id,
        },
        include: redemptionInclude,
      });
    });

    return NextResponse.json({ redemption });
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
