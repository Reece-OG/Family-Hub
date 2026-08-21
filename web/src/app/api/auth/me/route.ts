import { NextResponse } from "next/server";
import { getCurrentDevice, getCurrentUser } from "@/lib/auth";

export async function GET() {
  const [user, device] = await Promise.all([
    getCurrentUser(),
    getCurrentDevice(),
  ]);
  if (!user) {
    return NextResponse.json({ user: null, device: null }, { status: 200 });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      color: user.color,
      avatarEmoji: user.avatarEmoji,
      permissions: user.permissions,
    },
    device: device, // null for email sessions; { id, name, location, useScreensaver } for devices
  });
}
