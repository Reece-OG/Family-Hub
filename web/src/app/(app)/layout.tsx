import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentDevice, getCurrentUser } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ReminderToaster } from "@/components/ReminderToaster";
import { SleepOverlay } from "@/components/SleepOverlay";
import { ScreensaverIdleTracker } from "@/components/ScreensaverIdleTracker";
import { getSettings } from "@/lib/settings";
import { effectiveModuleIds, moduleForPath } from "@/lib/modules";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // First-login guard: the bootstrap parent created by seed.cjs has this
  // flag set, so the very first sign-in with parent@example.com / changeme
  // is bounced to /setup where they pick a real email / name / password.
  // POST /api/auth/setup clears the flag once they've saved new details.
  if (user.mustChangeCredentials) redirect("/setup");

  // v4.7 — only home kiosks ("local devices") run the idle screensaver.
  // Email sessions on phones/laptops never get pulled into the slideshow.
  const device = await getCurrentDevice();
  const screensaverEnabled = Boolean(device?.useScreensaver);

  // v4.8.2 — resolve the effective module list for this session. The
  // global hide list (AppSettings.disabledModules) plus the per-kiosk hide
  // list (LocalDevice.hiddenModules) together drive what the nav renders
  // and what the route guard below enforces.
  //
  // getCurrentDevice() only carries what's in the session JWT (id, name,
  // location, useScreensaver) — the kiosk hide list lives on the DB row
  // and isn't worth bloating every JWT for. Fetch it once per page render
  // when a device session is active. One extra round-trip on kiosks is
  // fine; email sessions skip the lookup entirely.
  const settings = await getSettings();
  let deviceHidden: unknown = null;
  if (device) {
    const row = await prisma.localDevice.findUnique({
      where: { id: device.id },
      select: { hiddenModules: true },
    });
    deviceHidden = row?.hiddenModules ?? null;
  }
  const visibleSet = effectiveModuleIds({
    globalDisabled: settings.disabledModules,
    deviceHidden,
  });
  const visibleModules = Array.from(visibleSet);

  // v4.8.2 — direct-URL guard. The middleware stamps the request path on
  // x-pathname; we resolve it back to a module and redirect the user away
  // if it's hidden. This is the half of the "lock down a kitchen kiosk"
  // story that hiding nav entries doesn't cover — without this, a
  // determined passerby could still type /settings into the address bar.
  const pathname = headers().get("x-pathname") || "";
  const requestedModule = moduleForPath(pathname);
  if (
    requestedModule &&
    requestedModule.id !== "dashboard" &&
    !visibleSet.has(requestedModule.id)
  ) {
    redirect("/dashboard");
  }

  const me = {
    id: user.id,
    name: user.name,
    role: user.role,
    color: user.color,
    avatarEmoji: user.avatarEmoji,
    permissions: user.permissions
      ? (Object.fromEntries(
          Object.entries(user.permissions).filter(([k]) => k.startsWith("can"))
        ) as Record<string, boolean>)
      : null,
    // v4.7.4 — tells client components (Nav primarily) that the session is a
    // kiosk so we can hide "private to me" tabs.
    isDevice: Boolean(device),
    // v4.8.2 — list of module IDs visible in this session. Nav.tsx filters
    // its items against this list before rendering.
    visibleModules,
  };

  return (
    <div className="min-h-screen">
      <AppShell me={me}>{children}</AppShell>
      <ReminderToaster />
      <SleepOverlay />
      <ScreensaverIdleTracker enabled={screensaverEnabled} />
    </div>
  );
}
