import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import {
  computeNextDue,
  DEVICE_TYPE_ORDER,
  refreshMaintenanceSchedule,
} from "@/lib/maintenance";

const deviceEnum = z.enum(DEVICE_TYPE_ORDER);

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  deviceType: deviceEnum.optional(),
  serviceIntervalMonths: z.number().int().min(1).max(120).optional(),
  identifier: z.string().max(120).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  remindEnabled: z.boolean().optional(),
  lastServicedAt: z.string().optional().nullable(),
  nextServiceDue: z.string().optional().nullable(),
  registrationNumber: z.string().max(120).optional().nullable(),
  registrationExpiresAt: z.string().optional().nullable(),
  registrationDocFilename: z.string().max(300).optional().nullable(),
  insuranceProvider: z.string().max(120).optional().nullable(),
  insurancePolicyNumber: z.string().max(120).optional().nullable(),
  insuranceExpiresAt: z.string().optional().nullable(),
  insuranceDocFilename: z.string().max(300).optional().nullable(),
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
    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true, avatarEmoji: true, color: true } },
        serviceRecords: {
          orderBy: { servicedAt: "desc" },
          include: {
            loggedBy: { select: { id: true, name: true, avatarEmoji: true } },
          },
        },
      },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");
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
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }
    const existing = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Maintenance item not found");
    const input = patchSchema.parse(await req.json());

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.deviceType !== undefined) data.deviceType = input.deviceType;
    if (input.identifier !== undefined)
      data.identifier = input.identifier?.trim() || null;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.remindEnabled !== undefined)
      data.remindEnabled = input.remindEnabled;
    if (input.registrationNumber !== undefined)
      data.registrationNumber = input.registrationNumber?.trim() || null;
    if (input.registrationDocFilename !== undefined)
      data.registrationDocFilename =
        input.registrationDocFilename?.trim() || null;
    if (input.insuranceProvider !== undefined)
      data.insuranceProvider = input.insuranceProvider?.trim() || null;
    if (input.insurancePolicyNumber !== undefined)
      data.insurancePolicyNumber = input.insurancePolicyNumber?.trim() || null;
    if (input.insuranceDocFilename !== undefined)
      data.insuranceDocFilename = input.insuranceDocFilename?.trim() || null;
    if (input.registrationExpiresAt !== undefined) {
      data.registrationExpiresAt = input.registrationExpiresAt
        ? new Date(input.registrationExpiresAt)
        : null;
      // Changing the expiry invalidates any prior "almost expired" email.
      data.registrationReminderSpawnedAt = null;
    }
    if (input.insuranceExpiresAt !== undefined) {
      data.insuranceExpiresAt = input.insuranceExpiresAt
        ? new Date(input.insuranceExpiresAt)
        : null;
      data.insuranceReminderSpawnedAt = null;
    }

    // Interval changes ripple into the next-due date.
    const newInterval =
      input.serviceIntervalMonths ?? existing.serviceIntervalMonths;
    if (input.serviceIntervalMonths !== undefined) {
      data.serviceIntervalMonths = input.serviceIntervalMonths;
    }

    if (input.lastServicedAt !== undefined) {
      data.lastServicedAt = input.lastServicedAt
        ? new Date(input.lastServicedAt)
        : null;
    }

    // Explicit next-due beats the derived one when both are supplied.
    if (input.nextServiceDue !== undefined) {
      data.nextServiceDue = input.nextServiceDue
        ? new Date(input.nextServiceDue)
        : null;
    } else if (
      input.serviceIntervalMonths !== undefined ||
      input.lastServicedAt !== undefined
    ) {
      const last =
        input.lastServicedAt !== undefined
          ? input.lastServicedAt
            ? new Date(input.lastServicedAt)
            : null
          : existing.lastServicedAt;
      data.nextServiceDue = last ? computeNextDue(last, newInterval) : null;
      // Interval/schedule change — let the reminder fire again if it's due.
      data.lastReminderSpawnedAt = null;
    }

    const item = await prisma.maintenanceItem.update({
      where: { id: params.id },
      data,
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageMaintenance")) {
      throw new HttpError(403, "No permission to manage maintenance");
    }
    await prisma.maintenanceItem.delete({ where: { id: params.id } });
    // Ensure no orphan schedule refresh.
    await refreshMaintenanceSchedule(params.id).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
