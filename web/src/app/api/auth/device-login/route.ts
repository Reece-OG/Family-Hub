import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createDeviceSessionToken,
  setSessionCookie,
} from "@/lib/auth";
import { getClientIp, isLocalNetworkIp } from "@/lib/network";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

// v4.7 — sign in as a "Local Device" (kiosk). Restricted to clients on the
// home/private network so a leaked device password can't be used to take
// over the account from outside.
export async function POST(req: NextRequest) {
  // Network gate first — keeps the timing of failed credentials private to
  // local users only.
  const ip = getClientIp(req);
  if (!isLocalNetworkIp(ip)) {
    return NextResponse.json(
      {
        error:
          "Local device sign-in is only available on the home network. Use email sign-in instead.",
      },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const { name, password } = schema.parse(body);

    // Case-insensitive lookup so "Living Room" and "living room" both work
    // at the keyboard.
    const device = await prisma.localDevice.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      include: {
        actAsUser: { include: { permissions: true } },
      },
    });
    if (!device || !device.actAsUser) {
      return NextResponse.json(
        { error: "Unknown device or password" },
        { status: 401 },
      );
    }
    const ok = await bcrypt.compare(password, device.passwordHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Unknown device or password" },
        { status: 401 },
      );
    }

    const u = device.actAsUser;
    const token = await createDeviceSessionToken({
      userId: u.id,
      role: u.role,
      email: u.email,
      userName: u.name,
      deviceId: device.id,
      deviceName: device.name,
      deviceLocation: device.location,
      useScreensaver: device.useScreensaver,
    });
    setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        color: u.color,
        avatarEmoji: u.avatarEmoji,
      },
      device: {
        id: device.id,
        name: device.name,
        location: device.location,
        useScreensaver: device.useScreensaver,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
