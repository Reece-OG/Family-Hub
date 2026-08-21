"use client";

// v4.9.7 — install help.
//
// Detects the visitor's browser + OS via UA / feature checks and renders
// instructions tailored to whatever combination they're on:
//
//   • Chromium-family browsers (Chrome / Edge / Brave / Opera / Vivaldi):
//     wait for the beforeinstallprompt event, then surface a button that
//     calls prompt().userChoice. Falls back to manual menu instructions
//     if the event hasn't fired (Chromium gates the prompt on engagement
//     heuristics, so we can't assume it's always there).
//
//   • Safari on iOS / iPadOS: the Share → Add to Home Screen recipe.
//
//   • Firefox on Linux: no built-in install. We generate a .desktop file
//     pointing Firefox at the current origin in --kiosk mode, with a
//     download link. The user drops the file into ~/.local/share/
//     applications/ (or ~/Desktop) and gets a launcher icon. We provide
//     copy-paste shell snippets too so the impatient can one-liner it.
//
//   • Firefox on Windows / macOS: similar story (no native install), but
//     the .desktop file isn't useful. We point users at Chrome / Edge.
//
//   • Anything else (older Edge, weird embedded browsers): generic
//     "your browser doesn't support this — try Chrome / Edge" copy.

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Share2 } from "lucide-react";

type Platform = "linux" | "windows" | "mac" | "ios" | "android" | "other";
type BrowserFamily = "chromium" | "firefox" | "safari" | "other";

interface Env {
  platform: Platform;
  browser: BrowserFamily;
  isStandalone: boolean;
}

function detectEnv(): Env {
  if (typeof window === "undefined") {
    return { platform: "other", browser: "other", isStandalone: false };
  }
  const ua = navigator.userAgent || "";
  let platform: Platform = "other";
  if (/Android/i.test(ua)) platform = "android";
  else if (/iPad|iPhone|iPod/.test(ua)) platform = "ios";
  // iPad on iPadOS 13+ reports as Mac with maxTouchPoints > 1.
  else if (
    /Macintosh/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  ) {
    platform = "ios";
  } else if (/Mac/i.test(ua)) platform = "mac";
  else if (/Win/i.test(ua)) platform = "windows";
  else if (/Linux/i.test(ua)) platform = "linux";

  let browser: BrowserFamily = "other";
  if (/Firefox|FxiOS/i.test(ua)) browser = "firefox";
  else if (/Edg|Chrome|CriOS|Brave|OPR|Vivaldi/i.test(ua)) browser = "chromium";
  else if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) browser = "safari";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standalone = Boolean(
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as any).standalone === true,
  );

  return { platform, browser, isStandalone: standalone };
}

// .desktop file body for the Firefox-on-Linux flow. We embed the live
// origin so the launcher always points at the host the user is currently
// using — if they later switch domains they just re-download.
function makeDesktopFile(origin: string): string {
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

// v5.0.2 — Chromium-on-Linux .desktop equivalent. Raspberry Pi OS still
// names the binary `chromium-browser`; modern distros use `chromium`. We
// try chromium-browser first and fall back to chromium so the launcher
// works on either without manual editing.
//
// `--kiosk` removes the address bar and tab UI entirely — that's the
// right default for a wall-mounted kitchen screen. Users who want a
// movable app-mode window can replace it with `--app=URL` themselves.
function makeChromiumDesktopFile(origin: string): string {
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

export function InstallHelpView() {
  const [env, setEnv] = useState<Env | null>(null);
  // beforeinstallprompt is the Chromium PWA install event. We capture it
  // on mount and re-fire on user click. The event is non-replayable so we
  // null it out after use.
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installResult, setInstallResult] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string>("");

  useEffect(() => {
    setEnv(detectEnv());
    setOrigin(window.location.origin);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt as EventListener);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        onPrompt as EventListener,
      );
    };
  }, []);

  // v5.0.3 — hrefs now point at a real server endpoint instead of
  // data: URLs. Chromium in --kiosk mode silently fails on data:
  // downloads (treats them as suspicious and aborts without any user-
  // visible feedback). A normal HTTP GET with Content-Disposition:
  // attachment works everywhere — Pi, Mac, Linux, Windows — and the
  // server bakes the live origin into the Exec= line from the request
  // host, so the file is always self-consistent.
  const desktopFileHref = "/api/install/launcher.desktop?browser=firefox";
  const chromiumDesktopFileHref =
    "/api/install/launcher.desktop?browser=chromium";

  // PWA install requires HTTPS (or localhost). Most self-hosted Family
  // Hub deployments are HTTP-only on LAN, in which case beforeinstallprompt
  // will never fire and the user is stuck. Detect that so we can surface
  // a clear explanation instead of "the button is greyed for some reason".
  const isSecureContext = useMemo(() => {
    if (typeof window === "undefined") return true;
    return window.isSecureContext;
  }, []);

  async function runInstallPrompt() {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallResult(
        choice.outcome === "accepted"
          ? "Installed. Look for Family Hub in your apps list."
          : "Install dismissed. You can return to this page later and try again.",
      );
    } catch (e) {
      setInstallResult(
        e instanceof Error ? e.message : "Install failed unexpectedly.",
      );
    } finally {
      setInstallPrompt(null);
    }
  }

  if (!env) return <p className="muted text-sm">Detecting browser…</p>;

  if (env.isStandalone) {
    return (
      <div className="card p-5 space-y-3">
        <h2 className="font-bold text-lg">You&apos;re already installed</h2>
        <p className="text-sm muted">
          This window is running Family Hub as a standalone app. There&apos;s
          nothing further to do — you can pin the app from your launcher, taskbar
          or home screen the way you would any other.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="muted text-sm">
        Installing puts a Family Hub icon on your phone&apos;s home screen or
        your computer&apos;s desktop, opens the app in its own window without
        browser chrome, and enables push notifications on iOS. We&apos;ve
        detected you&apos;re on <strong>{prettyBrowser(env.browser)}</strong>{" "}
        / <strong>{prettyPlatform(env.platform)}</strong>.
      </p>

      {env.browser === "chromium" && env.platform === "linux" && (
        <ChromiumLinuxInstructions
          canPrompt={Boolean(installPrompt)}
          isSecureContext={isSecureContext}
          result={installResult}
          onPrompt={runInstallPrompt}
          desktopFileHref={chromiumDesktopFileHref}
          origin={origin}
        />
      )}
      {env.browser === "chromium" && env.platform !== "linux" && (
        <ChromiumInstructions
          canPrompt={Boolean(installPrompt)}
          isSecureContext={isSecureContext}
          result={installResult}
          onPrompt={runInstallPrompt}
        />
      )}
      {env.browser === "safari" && env.platform === "ios" && (
        <SafariIOSInstructions />
      )}
      {env.browser === "safari" && env.platform === "mac" && (
        <SafariMacInstructions />
      )}
      {env.browser === "firefox" && env.platform === "linux" && (
        <FirefoxLinuxInstructions
          desktopFileHref={desktopFileHref}
          origin={origin}
        />
      )}
      {env.browser === "firefox" && env.platform !== "linux" && (
        <FirefoxOtherInstructions />
      )}
      {env.browser === "other" && <GenericInstructions />}
    </div>
  );
}

function prettyBrowser(b: BrowserFamily): string {
  switch (b) {
    case "chromium":
      return "a Chromium-based browser";
    case "firefox":
      return "Firefox";
    case "safari":
      return "Safari";
    default:
      return "this browser";
  }
}
function prettyPlatform(p: Platform): string {
  switch (p) {
    case "linux":
      return "Linux";
    case "windows":
      return "Windows";
    case "mac":
      return "macOS";
    case "ios":
      return "iOS / iPadOS";
    case "android":
      return "Android";
    default:
      return "this device";
  }
}

function ChromiumInstructions({
  canPrompt,
  isSecureContext,
  result,
  onPrompt,
}: {
  canPrompt: boolean;
  isSecureContext: boolean;
  result: string | null;
  onPrompt: () => void;
}) {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-bold text-lg">Install via Chrome / Edge</h2>
      <p className="text-sm">
        Your browser has a native install flow. Click below to launch it:
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onPrompt}
        disabled={!canPrompt}
      >
        <Download size={16} />
        Install Family Hub
      </button>
      {/* v5.0.2 — surface the HTTPS / secure-context requirement as the
          primary reason the button might be greyed. Self-hosted Family
          Hub deployments are usually HTTP-only on the LAN, and Chromium
          refuses to show the install affordance over HTTP. Saves the
          user from staring at a disabled button wondering why. */}
      {!canPrompt && !isSecureContext && (
        <div className="text-xs rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          <strong>You&apos;re accessing Family Hub over HTTP.</strong>{" "}
          Chromium only offers app install over <strong>HTTPS</strong> (or
          localhost). Either put Family Hub behind a reverse proxy with a
          TLS certificate, access it via <code>https://</code>, or use the
          browser-menu install if your build still allows it.
        </div>
      )}
      {!canPrompt && isSecureContext && (
        <p className="text-xs muted">
          The button is greyed because Chromium gates the install prompt on
          engagement (it wants you to actually use the site first). Visit
          the app for a minute or two and reload this page, or use the
          browser menu: <strong>⋮ → Install Family Hub</strong> (Chrome) /{" "}
          <strong>⋯ → Apps → Install this site as an app</strong> (Edge).
        </p>
      )}
      {result && (
        <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200">
          {result}
        </div>
      )}
    </div>
  );
}

// v5.0.2 — Chromium on Linux, distinct from Chromium on macOS / Windows.
// The native PWA install path applies as usual when it can, but on
// Raspberry Pi / NUC kiosks the dominant failure mode is "no HTTPS so
// no install prompt and Chromium's --kiosk hides the browser menu so
// there's no manual install path either." The .desktop launcher gets
// them unstuck regardless: a kiosk-mode Chromium pointed at the current
// Family Hub origin, droppable into ~/.local/share/applications/.
function ChromiumLinuxInstructions({
  canPrompt,
  isSecureContext,
  result,
  onPrompt,
  desktopFileHref,
  origin,
}: {
  canPrompt: boolean;
  isSecureContext: boolean;
  result: string | null;
  onPrompt: () => void;
  desktopFileHref: string;
  origin: string;
}) {
  return (
    <>
      <div className="card p-5 space-y-3">
        <h2 className="font-bold text-lg">
          Install as a PWA (Chrome / Chromium on Linux)
        </h2>
        <p className="text-sm">
          Your browser has a native install flow when conditions allow.
          Click below to launch it:
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onPrompt}
          disabled={!canPrompt}
        >
          <Download size={16} />
          Install Family Hub
        </button>
        {!canPrompt && !isSecureContext && (
          <div className="text-xs rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
            <strong>You&apos;re accessing Family Hub over HTTP.</strong>{" "}
            Chromium only offers app install over <strong>HTTPS</strong> (or
            localhost). The desktop launcher below works fine over HTTP and
            is usually what you want on a kiosk anyway.
          </div>
        )}
        {!canPrompt && isSecureContext && (
          <p className="text-xs muted">
            The button is greyed because Chromium gates the install prompt
            on engagement (it wants you to actually use the site first).
            Visit the app for a minute or two and reload this page, or
            grab the desktop launcher below.
          </p>
        )}
        {result && (
          <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200">
            {result}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-bold text-lg">
          Or: kiosk-mode launcher (works without HTTPS)
        </h2>
        <p className="text-sm">
          Download a <strong>.desktop launcher</strong> below — it opens
          Chromium in <code>--kiosk</code> mode pointed at this Family Hub
          installation. Perfect for a wall-mounted Raspberry Pi or
          mini-PC: full-screen, no browser chrome. Works over plain HTTP
          on the LAN, no certificate setup needed.
        </p>
        <a
          href={desktopFileHref}
          download="family-hub-chromium.desktop"
          className="btn btn-primary inline-flex w-fit"
        >
          <Download size={16} />
          Download family-hub-chromium.desktop
        </a>
        <div className="text-sm space-y-2">
          <p>Then, in a terminal:</p>
          <pre className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] p-3 text-xs overflow-x-auto">
{`mkdir -p ~/.local/share/applications
mv ~/Downloads/family-hub-chromium.desktop ~/.local/share/applications/
chmod +x ~/.local/share/applications/family-hub-chromium.desktop`}
          </pre>
          <p className="text-xs muted">
            The launcher tries <code>chromium-browser</code> first (the
            binary name on Raspberry Pi OS) and falls back to{" "}
            <code>chromium</code> (modern distros). Edit the
            <code> Exec=</code> line if your distro names it something
            else, or swap <code>--kiosk</code> for{" "}
            <code>--app=URL</code> if you&apos;d rather get a windowed
            app instead of full-screen.
          </p>
        </div>
        <p className="text-xs muted">
          The launcher points at <code>{origin}</code>. If you ever move
          Family Hub to a different hostname, come back here from the new
          URL and re-download.
        </p>
      </div>
    </>
  );
}

function SafariIOSInstructions() {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-bold text-lg">Add to Home Screen on iPhone / iPad</h2>
      <ol className="list-decimal pl-5 text-sm space-y-1.5">
        <li>
          Tap the <Share2 size={14} className="inline -mt-0.5" />{" "}
          <strong>Share</strong> button in Safari&apos;s toolbar.
        </li>
        <li>
          Scroll down and tap <strong>Add to Home Screen</strong>.
        </li>
        <li>
          Confirm the name and tap <strong>Add</strong>.
        </li>
        <li>
          Open Family Hub from your new home-screen icon — that launches it
          as a standalone app, which is also the version that can receive
          push notifications.
        </li>
      </ol>
      <p className="text-xs muted">
        Push notifications on iOS only work when Family Hub is launched from
        the home-screen icon. Opening it in Safari directly won&apos;t enable
        them, so this step is more important than it looks.
      </p>
    </div>
  );
}

function SafariMacInstructions() {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-bold text-lg">Add to Dock on macOS</h2>
      <p className="text-sm">
        Safari 17+ supports installing web apps to the Dock. From the menu
        bar, choose <strong>File → Add to Dock…</strong>, confirm the name,
        and Family Hub will open as a standalone app from your Dock from
        now on.
      </p>
    </div>
  );
}

function FirefoxLinuxInstructions({
  desktopFileHref,
  origin,
}: {
  desktopFileHref: string;
  origin: string;
}) {
  return (
    <div className="card p-5 space-y-4">
      <h2 className="font-bold text-lg">Install on Linux via Firefox</h2>
      <p className="text-sm">
        Firefox doesn&apos;t have a built-in PWA installer on desktop. Instead,
        download a <strong>.desktop launcher</strong> below — it runs Firefox
        in kiosk mode pointed at this Family Hub installation, so you get a
        full-screen app from your applications grid.
      </p>
      <a
        href={desktopFileHref}
        download="family-hub.desktop"
        className="btn btn-primary inline-flex w-fit"
      >
        <Download size={16} />
        Download family-hub.desktop
      </a>
      <div className="text-sm space-y-2">
        <p>Then, in a terminal:</p>
        <pre className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] p-3 text-xs overflow-x-auto">
{`mkdir -p ~/.local/share/applications
mv ~/Downloads/family-hub.desktop ~/.local/share/applications/
chmod +x ~/.local/share/applications/family-hub.desktop`}
        </pre>
        <p className="text-xs muted">
          On most desktop environments (GNOME, KDE, Cinnamon, XFCE…) the
          new launcher appears in your applications menu / activities grid
          within a few seconds. Right-click → <em>Pin to Favourites</em> to
          put it on the dock.
        </p>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          Want to use Chrome / Chromium for a real PWA install instead?
        </summary>
        <p className="text-xs muted mt-2">
          Chromium-based browsers support proper PWA installation on Linux
          (the Family Hub icon appears in your applications menu, opens in
          its own window, has its own taskbar entry). Open this page in
          Chrome, Chromium, Edge or Brave and you&apos;ll get the in-place
          install button.
        </p>
      </details>
      <p className="text-xs muted">
        The launcher points at <code>{origin}</code>. If you ever move your
        Family Hub server to a different hostname, come back here from the
        new URL and re-download.
      </p>
    </div>
  );
}

function FirefoxOtherInstructions() {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-bold text-lg">Firefox on this OS doesn&apos;t install</h2>
      <p className="text-sm">
        Firefox on desktop doesn&apos;t have a native PWA install flow. To
        get an icon-in-the-Start-Menu experience, open Family Hub in Chrome
        or Edge instead — they have a proper install affordance.
      </p>
      <p className="text-xs muted">
        Bookmarking the page is the closest thing Firefox can offer on its
        own.
      </p>
    </div>
  );
}

function GenericInstructions() {
  return (
    <div className="card p-5 space-y-3">
      <h2 className="font-bold text-lg">No automatic install available</h2>
      <p className="text-sm">
        We don&apos;t have a tailored install flow for this browser. For
        the best Family Hub experience, install one of Chrome / Edge / Brave
        on your device and open this page again — they have a built-in
        &ldquo;Install app&rdquo; affordance.
      </p>
    </div>
  );
}

// Augment the global Window type with the Chromium-only event we capture.
declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: ReadonlyArray<string>;
    readonly userChoice: Promise<{
      outcome: "accepted" | "dismissed";
      platform: string;
    }>;
    prompt(): Promise<void>;
  }
}
