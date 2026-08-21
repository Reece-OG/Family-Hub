// v5.0.3 — server-side .desktop launcher download.
//
// Previously the /install page generated launcher files as data: URLs
// embedded directly in the download link. That works on most browsers
// but Chromium in --kiosk mode treats data: downloads as suspicious and
// silently fails — the user clicks the link, nothing happens, no
// download appears. Serving the file over a normal HTTP route with
// Content-Disposition: attachment avoids the problem entirely.
//
// We accept ?browser=chromium|firefox and read the request host so the
// baked Exec= line matches the user's network view of Family Hub. No
// auth: the file is just a text snippet referencing the public origin
// and a browser binary — nothing sensitive to leak.

import { NextRequest } from "next/server";

function makeChromiumDesktop(origin: string): string {
  return `[Desktop Entry]
Name=Family Hub
GenericName=Family dashboard
Comment=Open Family Hub in kiosk mode (Chromium)
Exec=sh -c "chromium-browser --kiosk ${origin} 2>/dev/null || chromium --kiosk ${origin}"
Icon=internet-web-browser
Terminal=false
Type=Application
Categories=Network;Office;
StartupNotify=true
`;
}

function makeFirefoxDesktop(origin: string): string {
  return `[Desktop Entry]
Name=Family Hub
GenericName=Family dashboard
Comment=Open Family Hub in kiosk mode
Exec=firefox --kiosk ${origin}
Icon=internet-web-browser
Terminal=false
Type=Application
Categories=Network;Office;
StartupNotify=true
`;
}

// Derive the effective origin from the request. Behind a reverse proxy we
// honour x-forwarded-proto / x-forwarded-host so the .desktop file points
// at the user-visible URL rather than the internal one the Node process
// hears about. Falls back to req.nextUrl.origin when no proxy headers
// are present (direct LAN access on port 3000).
function originFromRequest(req: NextRequest): string {
  const proto =
    req.headers.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "") ||
    "http";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    req.nextUrl.host;
  if (host) return `${proto}://${host}`;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  const browser = (
    req.nextUrl.searchParams.get("browser") || "chromium"
  ).toLowerCase();
  const origin = originFromRequest(req);
  const body =
    browser === "firefox"
      ? makeFirefoxDesktop(origin)
      : makeChromiumDesktop(origin);
  const filename =
    browser === "firefox"
      ? "family-hub-firefox.desktop"
      : "family-hub-chromium.desktop";

  return new Response(body, {
    status: 200,
    headers: {
      // application/x-desktop is the canonical type for .desktop files
      // per the FreeDesktop spec; browsers treat it as "save, don't
      // render", which is what we want.
      "Content-Type": "application/x-desktop; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // No caching — the file embeds the live origin, which can change
      // if the operator points Family Hub at a different host.
      "Cache-Control": "no-store",
    },
  });
}
