import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { computeNextDue, DEVICE_TYPE_ORDER } from "@/lib/maintenance";

const deviceEnum = z.enum(DEVICE_TYPE_ORDER);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  deviceType: deviceEnum,
  serviceIntervalMonths: z.number().int().min(1).max(120),
  identifier: z.string().max(120).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  remindEnabled: z.boolean().optional(),
  // Optional seed values for items that are already in service.
  lastServicedAt: z.string().optional().nullable(),
  nextServiceDue: z.string().optional().nullable(),
  // v4.4 additions — registration & insurance.
  registrationNumber: z.string().max(120).optional().nullable(),
  registrationExpiresAt: z.string().optional().nullable(),
  registrationDocFilename: z.string().max(300).optional().nullable(),
  insuranceProvider: z.string().max(120).optional().nullable(),
  insurancePolicyNumber: z.string().max(120).optional().nullable(),
  insuranceExpiresAt: z.string().optional().nullable(),
  insuranceDocFilename: z.string().max(300).optional().nullable(),
});

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMaintenance")) {
      throw new HttpError(403, "No permission to view maintenance");
    }
    const items = await prisma.maintenanceItem.findMany({
      orderBy: [{ nextServiceDue: "asc" }, { name: "asc" }],
      include: {
        owner: { select: { id: true, name: true, avatarEmoji: true, color: true } },
        serviceRecords: {
          orderBy: { servicedAt: "desc" },
          take: 1,
          select: { id: true, servicedAt: true, workDone: true },
        },
        _count: { select: { serviceRecords: true } },
      },
    });
    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }
    const input = createSchema.parse(await req.json());

    const lastServicedAt = input.lastServicedAt
      ? new Date(input.lastServicedAt)
      : null;
    // Prefer an explicit nextServiceDue; otherwise derive from last service.
    const nextServiceDue = input.nextServiceDue
      ? new Date(input.nextServiceDue)
      : lastServicedAt
        ? computeNextDue(lastServicedAt, input.serviceIntervalMonths)
        : null;

    const item = await prisma.maintenanceItem.create({
      data: {
        name: input.name.trim(),
        deviceType: input.deviceType,
        serviceIntervalMonths: input.serviceIntervalMonths,
        identifier: input.identifier?.trim() || null,
        notes: input.notes?.trim() || null,
        remindEnabled: input.remindEnabled ?? true,
        lastServicedAt,
        nextServiceDue,
        ownerId: me.id,
        registrationNumber: input.registrationNumber?.trim() || null,
        registrationExpiresAt: input.registrationExpiresAt
          ? new Date(input.registrationExpiresAt)
          : null,
        registrationDocFilename: input.registrationDocFilename?.trim() || null,
        insuranceProvider: input.insuranceProvider?.trim() || null,
        insurancePolicyNumber: input.insurancePolicyNumber?.trim() || null,
        insuranceExpiresAt: input.insuranceExpiresAt
          ? new Date(input.insuranceExpiresAt)
          : null,
        insuranceDocFilename: input.insuranceDocFilename?.trim() || null,
      },
      include: {
        owner: { select: { id: true, name: true, avatarEmoji: true, color: true } },
        serviceRecords: {
          orderBy: { servicedAt: "desc" },
          take: 1,
          select: { id: true, servicedAt: true, workDone: true },
        },
        _count: { select: { serviceRecords: true } },
      },
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
