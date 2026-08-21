import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { refreshMaintenanceSchedule } from "@/lib/maintenance";

const createSchema = z.object({
  servicedAt: z.string(), // ISO date
  workDone: z.string().min(1).max(4000),
  performedBy: z.string().max(200).optional().nullable(),
  cost: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMaintenance")) {
      throw new HttpError(403, "No permission to view maintenance");
    }
    const records = await prisma.serviceRecord.findMany({
      where: { itemId: params.id },
      orderBy: { servicedAt: "desc" },
      include: {
        loggedBy: {
          select: { id: true, name: true, avatarEmoji: true, color: true },
        },
      },
    });
    return NextResponse.json({ records });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to log services");
    }
    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");

    const input = createSchema.parse(await req.json());
    const servicedAt = new Date(input.servicedAt);
    if (isNaN(servicedAt.getTime())) {
      throw new HttpError(400, "Invalid date");
    }

    const record = await prisma.serviceRecord.create({
      data: {
        itemId: params.id,
        servicedAt,
        workDone: input.workDone.trim(),
        performedBy: input.performedBy?.trim() || null,
        cost: input.cost ?? null,
        notes: input.notes?.trim() || null,
        loggedById: me.id,
      },
      include: {
        loggedBy: {
          select: { id: true, name: true, avatarEmoji: true, color: true },
        },
      },
    });

    // Recompute lastServicedAt / nextServiceDue and clear the reminder stamp.
    const refreshed = await refreshMaintenanceSchedule(params.id);

    return NextResponse.json({ record, item: refreshed });
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
