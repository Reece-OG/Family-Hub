// v4.9.1 — single source of truth for the post-update changelog modal.
//
// Newest first. Each entry maps a version string to a small list of
// highlights — keep them short and user-facing, not implementation notes.
// The UpdateChangelogModal compares the user's last-seen version (stored
// in localStorage) against the current build version (from package.json
// at server-render time) and shows every entry between the two.
//
// Adding a release? Drop a new entry at the TOP of CHANGELOG. The modal
// is purely additive: if a user is on v4.9.0 and we ship v4.9.4, they'll
// see the v4.9.4 + v4.9.3 + v4.9.2 + v4.9.1 entries on first launch,
// then never again.

export interface ChangelogEntry {
  version: string; // semver (e.g. "4.9.1")
  // Optional human title — defaults to "What's new in vX.Y.Z" in the UI.
  title?: string;
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "5.0.7",
    title: "Recipes: tap a recipe, land on the recipe",
    highlights: [
      "On phones and tablets, tapping a recipe now scrolls the detail into view instead of leaving it hidden below the whole list — no more scrolling past dozens of titles to see what you just picked.",
    ],
  },
  {
    version: "5.0.6",
    title: "Calendar: quick summary on click, edit on demand",
    highlights: [
      "Clicking an event on the calendar now shows a read-only summary first — title, when, where, who, recurrence — with an Edit button when you actually want to change something. No more accidental edits from a quick glance.",
      "To-dos on the calendar are now openable too. Same summary card, and an 'Open in To-Dos →' button that jumps you straight to that item in the To-Dos tab.",
    ],
  },
  {
    version: "5.0.5",
    title: "Dashboard staleness + shopping error-screen fix",
    highlights: [
      "Fixed the home screen (Coming Up, stat counts, etc.) showing stale info until you logged out and back in. Root cause was the offline cache pinning refresh data forever — narrowed the cache to just favicon/manifest and the hashed JS bundles.",
      "Fixed the Shopping tab occasionally dropping into an error screen when the API returned a brief non-JSON response — now it keeps the last-good list and quietly retries on the next tick.",
    ],
  },
  {
    version: "5.0.4",
    title: "iOS session persistence fix",
    highlights: [
      "Session cookie now carries an explicit Expires date alongside Max-Age. iOS Safari (particularly the home-screen PWA) sometimes treats Max-Age-only cookies as session cookies and clears them when you close the app — the extra Expires date makes iOS keep the login the full 30 days.",
    ],
  },
  {
    version: "5.0.3",
    title: "Install launcher downloads work in Chromium --kiosk",
    highlights: [
      "Replaced the data: URL .desktop download with a real server endpoint at /api/install/launcher.desktop — Chromium in --kiosk mode was silently failing on data: downloads.",
    ],
  },
  {
    version: "5.0.2",
    title: "Raspberry Pi kiosk install — Chromium .desktop launcher",
    highlights: [
      "Chromium-on-Linux kiosks (Raspberry Pi etc.) now get a downloadable .desktop launcher on /install — opens Chromium in --kiosk mode pointed at this Family Hub, works over plain HTTP without needing HTTPS.",
      "Install page now explains the HTTPS / engagement / kiosk-mode-menu constraints clearly when the native install button isn't available, instead of just greying it.",
    ],
  },
  {
    version: "5.0.1",
    title: "Welcome to v5 — kiosk fixes",
    highlights: [
      "Versioning rolled over from 4.9.x to 5.0.x. Same app, fresh number.",
      "Fixed the 'Install Family Hub on this device →' link being hidden on kiosks — that's where the Firefox .desktop launcher download lives.",
      "Fixed the 'Activate screensaver' button immediately bouncing back to the dashboard. The screensaver now waits 1.5 seconds after mount before listening for exit input, so the click that started it doesn't also stop it.",
    ],
  },
  {
    version: "4.9.9",
    title: "Dashboard recurring-event fix + smoother screensaver",
    highlights: [
      "Dashboard 'Next 7 days' and 'Coming Up' now correctly include recurring events (weekly chores, fortnightly bin nights, etc.) — they were silently dropped before. Each row shows the actual next-occurrence date, not the original first-instance date.",
      "Screensaver photo transitions made GPU-cheap on kiosk hardware: bg + fg now share a single composite layer, with explicit GPU promotion hints and a lighter blur. Should remove the jitter on Raspberry Pi / NUC class kiosks.",
    ],
  },
  {
    version: "4.9.8",
    title: "Smoother screensaver cross-fade",
    highlights: [
      "Screensaver photo transition extended to 1.5 seconds and rebuilt to wait for each image to actually load before fading in — no more 'pop in' on slower kiosks.",
    ],
  },
  {
    version: "4.9.7",
    title: "Kiosk fixes + install help",
    highlights: [
      "Fixed Ubuntu / Firefox kiosks not entering the screensaver — switched to an interval-based idle check that doesn't get throttled by Firefox.",
      "New 'Activate screensaver' button at the bottom of the sidebar — only visible on kiosks, lets you punt a screen into the slideshow on demand now that Settings is hidden there.",
      "New Install page at /install with platform-aware instructions, including a downloadable .desktop launcher for Firefox on Linux so you can pin Family Hub to your apps grid.",
    ],
  },
  {
    version: "4.9.6",
    title: "Smart-home screen control",
    highlights: [
      "Kiosks now emit device.sleep_started and device.sleep_ended webhooks when their night-sleep window begins and ends.",
      "Wire them into Home Assistant's HDMI-CEC integration to physically power your kiosk TV off and on overnight — see docs/api.md for a copy-paste automation.",
    ],
  },
  {
    version: "4.9.5",
    title: "Voice readout on kiosks",
    highlights: [
      "Kiosks can now read reminders aloud as they fire. Turn it on per-device in Settings → Local Devices.",
      "Walk up to the kiosk and visit /voice-settings to pick a voice from what that browser actually has — with previews.",
      "Silenced automatically during the kiosk's night-sleep window so it won't yell at 2am.",
    ],
  },
  {
    version: "4.9.4",
    title: "Screensaver polish + update-modal flicker fix",
    highlights: [
      "Screensaver photos now cross-fade between slides instead of cutting abruptly.",
      "Clock and date on the screensaver are re-sized to match the weather panel on the right — the photo gets a bit more room as a result.",
      "Fixed the update notice that flashed a few times after a deploy.",
    ],
  },
  {
    version: "4.9.3",
    title: "Photo upload fix",
    highlights: [
      "Fixed a bug where photo uploads silently failed (the file picker would close but nothing would actually upload).",
      "iPhone HEIC / HEIF photos are now accepted. Other browsers won't render HEIC inline, but the photos are stored safely.",
      "If you try to upload a file we can't accept (PDF, video, etc.) you now get a visible reason instead of nothing happening.",
    ],
  },
  {
    version: "4.9.2",
    title: "Family sticky notes",
    highlights: [
      "New: a fridge-magnet board for the family. Post a quick message in yellow / pink / green / blue — pinned notes float to the top.",
      "Dashboard now shows the latest 6 notes; the full /Notes page lets you edit, pin, and recolour.",
      "Anyone can post; you can edit or delete your own notes, parents can clean up anyone's.",
    ],
  },
  {
    version: "4.9.1",
    title: "Polish + the changelog you're reading",
    highlights: [
      "New: this changelog modal pops up once after each update so you can see what's new.",
      "Shopping catalog no longer auto-fills from typed items — the catalog only grows when you explicitly add a master.",
      "Birthdays page got a search bar.",
      "Small typography fix in Settings → App Modules.",
    ],
  },
  {
    version: "4.9.0",
    title: "Integrations",
    highlights: [
      "Public REST API at /api/v1 — query events, todos, shopping, and reminders with a bearer token.",
      "Outbound webhooks fire on reminder, todo, and event changes — point them at Home Assistant or n8n.",
      "New Integrations card in Settings to manage API tokens and webhook subscriptions.",
      "See docs/api.md on GitHub for payload shapes.",
    ],
  },
  {
    version: "4.8.2",
    title: "Multi-photo, responsive calendar, and module visibility",
    highlights: [
      "Multi-photo upload with drag-and-drop and per-file progress.",
      "The month calendar now scales to fill your kiosk's viewport.",
      "Screensaver re-laid out so the clock and weather get a proper top banner.",
      "App modules can be hidden globally or per-kiosk — hide Settings from the kitchen kiosk to lock it down.",
    ],
  },
  {
    version: "4.8.1",
    title: "Push reliability + parent opt-in",
    highlights: [
      "iOS reminders are far more reliable — high-priority push, tighter TTL, and a Safari-on-iOS install prompt.",
      "Parents can opt in to receive a copy of every reminder that fires on their children's events.",
      "Per-user kill switch for event reminders, set from the family edit dialog.",
    ],
  },
  {
    version: "4.7.19",
    title: "Shopping list overhaul",
    highlights: [
      "Reusable shopping master catalogue — quick-tap recurring items onto the list.",
      "Add ingredients from any recipe straight to the shopping list, individually or all at once.",
      "Menu builder still puts a week's recipes onto the list with one click.",
    ],
  },
];

// Used by the modal to decide which entries to render between two
// versions. Entries are filtered to the strict range (lastSeen, current];
// if lastSeen is null we return nothing (treat as first-visit silence).
export function entriesBetween(
  lastSeen: string | null,
  current: string,
): ChangelogEntry[] {
  if (!lastSeen) return [];
  const lastIdx = CHANGELOG.findIndex((e) => e.version === lastSeen);
  const currentIdx = CHANGELOG.findIndex((e) => e.version === current);
  // If we can't locate one of the boundaries (e.g. lastSeen is older
  // than the oldest entry we ship copy for), show everything from index
  // 0 up to currentIdx so the user still sees the new entries.
  const start = currentIdx === -1 ? 0 : currentIdx;
  const end = lastIdx === -1 ? CHANGELOG.length : lastIdx;
  if (end <= start) return [];
  return CHANGELOG.slice(start, end);
}
