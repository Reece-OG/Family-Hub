import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { deleteRewardImage } from "@/lib/reward-images";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional().nullable(),
  costPoints: z.number().int().min(1).max(1_000_000).optional(),
  categoryId: z.string().optional().nullable(),
  available: z.boolean().optional(),
  position: z.number().int().min(0).max(100_000).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireUser();
    const item = await prisma.rewardItem.findUnique({
      where: { id: params.id },
      include: { category: true },
    });
    if (!item) throw new HttpError(404, "Reward not found");
    return NextResponse.json({ item });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can edit rewards");
    }
    const existing = await prisma.rewardItem.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Reward not found");
    const input = patchSchema.parse(await req.json());
    if (input.categoryId) {
      const cat = await prisma.rewardCategory.findUnique({
        where: { id: input.categoryId },
      });
      if (!cat) throw new HttpError(400, "Category not found");
    }
    const item = await prisma.rewardItem.update({
      where: { id: params.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.costPoints !== undefined ? { costPoints: input.costPoints } : {}),
        ...(input.categoryId !== undefined
          ? { categoryId: input.categoryId || null }
          : {}),
        ...(input.available !== undefined ? { available: input.available } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
      include: { category: true },
    });
    return NextResponse.json({ item });
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can delete rewards");
    }
    const existing = await prisma.rewardItem.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Reward not found");
    if (existing.imageFilename) {
      await deleteRewardImage(existing.imageFilename);
    }
    // Existing redemptions reference rewardItemId with onDelete: SetNull, so
    // history survives but can't be re-redeemed.
    await prisma.rewardItem.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
