import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { HttpError, requireParent } from "@/lib/auth";
import { ALL_MODULE_IDS, MODULES } from "@/lib/modules";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(120),
  password: z.string().min(4).max(200),
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
  // v4.8.2 — per-kiosk module hide list. Unknown / pinned IDs are silently
  // dropped server-side so a future client that ships ahead of the server
  // doesn't 400 us.
  hiddenModules: z.array(z.string()).optional(),
  actAsUserId: z.string().min(1),
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
  // v4.8.2 — Prisma types Json columns as unknown.
  hiddenModules?: unknown;
  // v4.9.5 — voice readout fields. Optional in the input type so old
  // backups restoring without them don't trip the type-checker.
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

// GET /api/devices — parent-only list
export async function GET() {
  try {
    await requireParent();
    const devices = await prisma.localDevice.findMany({
      orderBy: { name: "asc" },
      include: {
        actAsUser: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json({ devices: devices.map(serialise) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/devices — parent-only create
export async function POST(req: NextRequest) {
  try {
    await requireParent();
    const body = await req.json();
    const input = createSchema.parse(body);

    // Make sure the target user exists before we hash a password for nothing.
    const target = await prisma.user.findUnique({
      where: { id: input.actAsUserId },
    });
    if (!target) {
      return NextResponse.json(
        { error: "Selected user does not exist" },
        { status: 400 },
      );
    }

    const existing = await prisma.localDevice.findFirst({
      where: { name: { equals: input.name, mode: "insensitive" } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A device with that name already exists" },
        { status: 409 },
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const device = await prisma.localDevice.create({
      data: {
        name: input.name,
        location: input.location,
        passwordHash,
        useScreensaver: input.useScreensaver ?? true,
        // Optional per-device knobs — leave undefined to let Prisma apply the
        // schema defaults (0 = no auto-screensaver, sleep mode off by default).
        ...(input.screensaverIdleMinutes !== undefined
          ? { screensaverIdleMinutes: input.screensaverIdleMinutes }
          : {}),
        ...(input.sleepModeEnabled !== undefined
          ? { sleepModeEnabled: input.sleepModeEnabled }
          : {}),
        ...(input.sleepStartTime !== undefined
          ? { sleepStartTime: input.sleepStartTime }
          : {}),
        ...(input.sleepEndTime !== undefined
          ? { sleepEndTime: input.sleepEndTime }
          : {}),
        ...(input.sleepIdleMinutes !== undefined
          ? { sleepIdleMinutes: input.sleepIdleMinutes }
          : {}),
        ...(input.hiddenModules !== undefined
          ? {
              hiddenModules: (() => {
                const valid = new Set<string>(ALL_MODULE_IDS);
                const kioskHideable = new Set(
                  MODULES.filter((m) => m.kioskHideable).map((m) => m.id),
                );
                return input.hiddenModules.filter(
                  (id) => valid.has(id) && kioskHideable.has(id as never),
                );
              })(),
            }
          : {}),
        actAsUserId: input.actAsUserId,
      },
      include: {
        actAsUser: { select: { id: true, name: true, email: true } },
      },
    });
    return NextResponse.json({ device: serialise(device) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
