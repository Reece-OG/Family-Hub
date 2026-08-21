import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const createSchema = z.object({
  childId: z.string().min(1),
  points: z.number().int().min(-10_000).max(10_000).refine((n) => n !== 0, {
    message: "Points must not be zero",
  }),
  reason: z.string().min(1).max(200),
});

// GET /api/points
//   ?childId=... — ledger for a single child (required for children; they can
//                  only see their own. Parents can view any child's ledger.)
//   no filter   — returns balances for all children (used by parent view)
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewRewards")) {
      throw new HttpError(403, "No permission to view rewards");
    }
    const url = new URL(req.url);
    const childId = url.searchParams.get("childId");

    if (childId) {
      if (me.role !== "PARENT" && childId !== me.id) {
        throw new HttpError(403, "You can only see your own ledger");
      }
      const [entries, agg] = await Promise.all([
        prisma.pointsTransaction.findMany({
          where: { childId },
          include: {
            awardedBy: {
              select: { id: true, name: true, color: true, avatarEmoji: true },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        prisma.pointsTransaction.aggregate({
          where: { childId },
          _sum: { points: true },
        }),
      ]);
      return NextResponse.json({
        entries,
        balance: agg._sum.points ?? 0,
        childId,
      });
    }

    // No childId — parents get overall roster; children only themselves.
    if (me.role !== "PARENT") {
      const agg = await prisma.pointsTransaction.aggregate({
        where: { childId: me.id },
        _sum: { points: true },
      });
      return NextResponse.json({
        balances: [{ childId: me.id, balance: agg._sum.points ?? 0 }],
      });
    }

    const children = await prisma.user.findMany({
      where: { role: "CHILD" },
      select: { id: true, name: true, color: true, avatarEmoji: true },
    });
    const balances = await Promise.all(
      children.map(async (c) => {
        const agg = await prisma.pointsTransaction.aggregate({
          where: { childId: c.id },
          _sum: { points: true },
        });
        return { ...c, balance: agg._sum.points ?? 0 };
      }),
    );
    return NextResponse.json({ balances });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can award or deduct points");
    }
    if (!can(me, "canManageRewards")) {
      throw new HttpError(403, "No permission to manage rewards");
    }
    const input = createSchema.parse(await req.json());
    const child = await prisma.user.findUnique({ where: { id: input.childId } });
    if (!child || child.role !== "CHILD") {
      throw new HttpError(400, "Target must be a child user");
    }
    const entry = await prisma.pointsTransaction.create({
      data: {
        childId: child.id,
        awardedById: me.id,
        points: input.points,
        reason: input.reason,
      },
      include: {
        awardedBy: {
          select: { id: true, name: true, color: true, avatarEmoji: true },
        },
      },
    });
    return NextResponse.json({ entry });
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
