import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/me/device-config — returns the effective per-device kiosk
// configuration for the current session.
//
// For device sessions we read the live LocalDevice row (so settings edits in
// the Local Devices panel take effect without requiring a re-login), for
// email sessions we return `device: null` which the client components use as
// a signal to stay dormant (phones/laptops don't get the kiosk screensaver or
// sleep overlay).
export async function GET() {
  const session = await getSession();
  if (!session?.did) {
    return NextResponse.json({ device: null });
  }
  const d = await prisma.localDevice.findUnique({
    where: { id: session.did },
    select: {
      id: true,
      name: true,
      useScreensaver: true,
      screensaverIdleMinutes: true,
      sleepModeEnabled: true,
      sleepStartTime: true,
      sleepEndTime: true,
      sleepIdleMinutes: true,
      // v4.9.5 — voice readout is owned by the LocalDevice row but
      // device-self-edit needs read access to render the settings page
      // correctly without a parent round-trip.
      voiceReadoutEnabled: true,
      voiceName: true,
      voiceRate: true,
    },
  });
  if (!d) return NextResponse.json({ device: null });
  return NextResponse.json({ device: d });
}

// v4.9.5 — PATCH /api/me/device-config lets the CURRENT device session
// update a small set of non-sensitive per-device settings without going
// through the parent-only /api/devices/[id] route. The voice readout
// configuration (toggle, voice name, rate) is the only thing the kiosk
// itself can change: someone at the kiosk taps the voice picker, plays
// a preview, and saves. They never need a parent's password.
//
// Email sessions are rejected — voice readout is a device feature, and
// the existing /api/devices/[id] PATCH already covers parents managing
// a kiosk from their phone.
const patchSchema = z.object({
  voiceReadoutEnabled: z.boolean().optional(),
  voiceName: z.string().max(120).nullable().optional(),
  voiceRate: z.number().min(0.5).max(2).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.did) {
    return NextResponse.json(
      { error: "Voice settings can only be changed from a kiosk session." },
      { status: 403 },
    );
  }
  let input: z.infer<typeof patchSchema>;
  try {
    input = patchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Only forward keys that were actually present in the body so we can do
  // partial patches without clobbering unrelated columns.
  const data: {
    voiceReadoutEnabled?: boolean;
    voiceName?: string | null;
    voiceRate?: number;
  } = {};
  if (input.voiceReadoutEnabled !== undefined) {
    data.voiceReadoutEnabled = input.voiceReadoutEnabled;
  }
  if (input.voiceName !== undefined) {
    // Treat blank strings as "use the system default" — the kiosk's voice
    // picker emits "" when the user clears their selection.
    data.voiceName = input.voiceName && input.voiceName.trim().length > 0
      ? input.voiceName.trim()
      : null;
  }
  if (input.voiceRate !== undefined) {
    data.voiceRate = input.voiceRate;
  }

  const updated = await prisma.localDevice.update({
    where: { id: session.did },
    data,
    select: {
      voiceReadoutEnabled: true,
      voiceName: true,
      voiceRate: true,
    },
  });
  return NextResponse.json({ device: updated });
}
