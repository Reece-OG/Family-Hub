import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { Screensaver } from "@/components/Screensaver";
import { SleepOverlay } from "@/components/SleepOverlay";

// Dedicated kiosk route — no navigation chrome. Designed to be opened in full
// screen on a tablet / kitchen display. Any input (keyboard/mouse/touch)
// quits back to the rest of the app, per the v4.6 screensaver redesign.
//
// v4.7.4 — `/screensaver` lives OUTSIDE the (app) route group, so the
// `SleepOverlay` mounted in (app)/layout.tsx never renders here. That meant
// the kiosk would happily keep cycling photos right through the configured
// night-sleep window. We mount the overlay directly on this page so the
// black night-mode cover layers over the slideshow as soon as the start
// time is reached.
export default async function ScreensaverPage() {
  const me = await requireUser();
  if (!can(me, "canViewPhotos")) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="muted">You don't have permission to view photos.</p>
      </main>
    );
  }
  const settings = await getSettings();
  return (
    <>
      <Screensaver
        intervalMs={settings.screensaverIntervalMs}
        shuffle={settings.screensaverShuffle}
        showWeather={settings.weatherEnabled && settings.weatherShowOnScreensaver}
        exitOnInput
      />
      <SleepOverlay />
    </>
  );
}
