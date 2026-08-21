import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireParent } from "@/lib/auth";
import { ALL_MODULE_IDS, MODULES } from "@/lib/modules";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  location: z.string().trim().min(1).max(120).optional(),
  // Leave undefined to keep the existing password; send a new string to rotate.
  password: z.string().min(4).max(200).optional(),
  useScreensaver: z.boolean().optional(),
  // v4.7.1 — per-device kiosk behaviour (moved from AppSettings).
  screensaverIdleMinutes: z.number().int().min(0).max(240).optional(),
  sleepModeEnabled: z.boolean().optional(),
  sleepStartTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected HH:mm")
    .optional(),
  sleepEndTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected HH:mm")
    .optional(),
  sleepIdleMinutes: z.number().int().min(1).max(240).optional(),
  actAsUserId: z.string().min(1).optional(),
  // v4.8.2 — per-kiosk module hide list. Each entry must be a known module
  // ID; unknown values are dropped silently so a future client that ships
  // ahead of the server doesn't 400 on us. Modules pinned globally
  // (dashboard) are also filtered out — hiding them on a kiosk would
  // strand the user with nowhere to land.
  hiddenModules: z.array(z.string()).optional(),
  // v4.9.5 — voice readout. Parents toggle on/off and adjust rate from
  // their phone; the voiceName picker is on the kiosk itself (since
  // available voices depend on the kiosk's browser).
  voiceReadoutEnabled: z.boolean().optional(),
  voiceName: z.string().max(120).nullable().optional(),
  voiceRate: z.number().min(0.5).max(2).optional(),
});

function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Invalid input", details: e.errors },
      { status: 400 },
    );
  }
  console.error(e);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

function serialise(d: {
  id: string;
  name: string;
  location: string;
  useScreensaver: boolean;
  screensaverIdleMinutes: number;
  sleepModeEnabled: boolean;
  sleepStartTime: string;
  sleepEndTime: string;
  sleepIdleMinutes: number;
  // v4.8.2 — Prisma types Json columns as unknown, so accept that here.
  hiddenModules?: unknown;
  // v4.9.5 — voice readout fields (may be undefined for older schemas).
  voiceReadoutEnabled?: boolean;
  voiceName?: string | null;
  voiceRate?: number;
  actAsUserId: string;
  actAsUser: { id: string; name: string; email: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    name: d.name,
    location: d.location,
    useScreensaver: d.useScreensaver,
    screensaverIdleMinutes: d.screensaverIdleMinutes,
    sleepModeEnabled: d.sleepModeEnabled,
    sleepStartTime: d.sleepStartTime,
    sleepEndTime: d.sleepEndTime,
    sleepIdleMinutes: d.sleepIdleMinutes,
    hiddenModules: Array.isArray(d.hiddenModules) ? d.hiddenModules : [],
    voiceReadoutEnabled: d.voiceReadoutEnabled ?? false,
    voiceName: d.voiceName ?? null,
    voiceRate: d.voiceRate ?? 1,
    actAsUserId: d.actAsUserId,
    actAsUser: d.actAsUser
      ? { id: d.actAsUser.id, name: d.actAsUser.name, email: d.actAsUser.email }
      : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireParent();
    const body = await req.json();
    const input = patchSchema.parse(body);

    const device = await prisma.localDevice.findUnique({
      where: { id: params.id },
    });
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    // If the user's being changed, make sure the new target exists.
    if (input.actAsUserId && input.actAsUserId !== device.actAsUserId) {
      const target = await prisma.user.findUnique({
        where: { id: input.actAsUserId },
      });
      if (!target) {
        return NextResponse.json(
          { error: "Selected user does not exist" },
          { status: 400 },
        );
      }
    }

    // If the name's being changed, reject duplicates — case-insensitive.
    if (input.name && input.name.toLowerCase() !== device.name.toLowerCase()) {
      const clash = await prisma.localDevice.findFirst({
        where: {
          id: { not: device.id },
          name: { equals: input.name, mode: "insensitive" },
        },
      });
      if (clash) {
        return NextResponse.json(
          { error: "A device with that name already exists" },
          { status: 409 },
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.location !== undefined) data.location = input.location;
    if (input.useScreensaver !== undefined) data.useScreensaver = input.useScreensaver;
    if (input.screensaverIdleMinutes !== undefined)
      data.screensaverIdleMinutes = input.screensaverIdleMinutes;
    if (input.sleepModeEnabled !== undefined)
      data.sleepModeEnabled = input.sleepModeEnabled;
    if (input.sleepStartTime !== undefined)
      data.sleepStartTime = input.sleepStartTime;
    if (input.sleepEndTime !== undefined)
      data.sleepEndTime = input.sleepEndTime;
    if (input.sleepIdleMinutes !== undefined)
      data.sleepIdleMinutes = input.sleepIdleMinutes;
    if (input.actAsUserId !== undefined) data.actAsUserId = input.actAsUserId;
    if (input.password !== undefined) {
      data.passwordHash = await bcrypt.hash(input.password, 10);
    }
    if (input.hiddenModules !== undefined) {
      const validIds = new Set<string>(ALL_MODULE_IDS);
      const kioskHideable = new Set(
        MODULES.filter((m) => m.kioskHideable).map((m) => m.id),
      );
      data.hiddenModules = input.hiddenModules.filter(
        (id) => validIds.has(id) && kioskHideable.has(id as never),
      );
    }
    // v4.9.5 — voice readout. Blank/whitespace voiceName collapses to null
    // so the device falls back to the system default voice.
    if (input.voiceReadoutEnabled !== undefined) {
      data.voiceReadoutEnabled = input.voiceReadoutEnabled;
    }
    if (input.voiceName !== undefined) {
      data.voiceName =
        input.voiceName && input.voiceName.trim().length > 0
          ? input.voiceName.trim()
          : null;
    }
    if (input.voiceRate !== undefined) {
      data.voiceRate = input.voiceRate;
    }

    const updated = await prisma.localDevice.update({
      where: { id: device.id },
      data,
      include: {
        actAsUser: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json({ device: serialise(updated) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireParent();
    const device = await prisma.localDevice.findUnique({
      where: { id: params.id },
    });
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }
    await prisma.localDevice.delete({ where: { id: device.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
