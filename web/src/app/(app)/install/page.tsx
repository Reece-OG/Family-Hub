import { InstallHelpView } from "@/components/InstallHelpView";

// v4.9.7 — platform-aware install help.
//
// Chromium browsers have a native "Install app" affordance. Safari on iOS
// needs Add to Home Screen. Firefox on desktop has no built-in install
// flow at all — we ship a downloadable .desktop launcher instead so Ubuntu
// users can pin Family Hub to their applications grid without manual
// editing of dotfiles. This page is the single discovery point.
export default function InstallPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Install Family Hub</h1>
      <InstallHelpView />
    </div>
  );
}
