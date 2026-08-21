"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useVoiceReadout, clampRate } from "@/lib/use-voice-readout";

type Reminder = {
  id: string;
  title: string;
  body: string | null;
  remindAt: string;
};

// v4.9.5 — minimal shape of the device-config response used to drive voice
// readout. Anything broader is overkill here.
interface DeviceVoiceConfig {
  voiceReadoutEnabled: boolean;
  voiceName: string | null;
  voiceRate: number;
  sleepModeEnabled: boolean;
  sleepStartTime: string;
  sleepEndTime: string;
}

const POLL_MS = 30_000;

// Helper: is the device currently inside its configured night-sleep window?
// We use this to silence voice readout overnight even if the screen happens
// to be awake. Times are stored as "HH:mm" in local clock time.
function inSleepWindow(
  cfg: Pick<
    DeviceVoiceConfig,
    "sleepModeEnabled" | "sleepStartTime" | "sleepEndTime"
  >,
  now: Date = new Date(),
): boolean {
  if (!cfg.sleepModeEnabled) return false;
  const [sh, sm] = cfg.sleepStartTime.split(":").map(Number);
  const [eh, em] = cfg.sleepEndTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  // Window wraps midnight when start > end (e.g. 22:00 → 07:00).
  return start < end
    ? minsNow >= start && minsNow < end
    : minsNow >= start || minsNow < end;
}

// Global in-app toaster. Polls /api/reminders/poll every 30 seconds and shows
// any of the current user's fired-but-unacknowledged reminders, stacked in
// the bottom-right corner. Dismiss to acknowledge on the server.
//
// v4.9.5 — also drives the voice-readout feature on kiosks. When the device
// has voice readout enabled, each NEW reminder is spoken via the Web Speech
// API. Reminders already on screen at first mount are not spoken (they're
// "history" — there's no point yelling about a reminder that fired before
// you walked into the room). Sleep-window times silence voice automatically.
export function ReminderToaster() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [voiceConfig, setVoiceConfig] = useState<DeviceVoiceConfig | null>(null);
  const pathname = usePathname();
  const voice = useVoiceReadout();

  // Track which reminder IDs we've already announced. On the first poll we
  // populate this without speaking anything — only subsequent new IDs get
  // the audio treatment.
  const spokenRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/reminders/poll", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      const list: Reminder[] = d.reminders || [];
      setReminders(list);

      // v4.9.5 — speak any reminder we haven't spoken yet, but skip the
      // initial-load batch so the kiosk doesn't yell on first paint.
      const seen = spokenRef.current;
      if (!initialisedRef.current) {
        for (const r of list) seen.add(r.id);
        initialisedRef.current = true;
        return;
      }
      if (!voiceConfig?.voiceReadoutEnabled) {
        // Voice is off — just stamp so we don't replay if it's turned on
        // later in this session.
        for (const r of list) seen.add(r.id);
        return;
      }
      if (inSleepWindow(voiceConfig)) {
        // Sleep window — record but don't speak. If the window ends and
        // a reminder is STILL unacknowledged on the next poll, we'll
        // again record-without-speaking, which is fine — the user is
        // already going to see the dismissable toast when they wake up.
        for (const r of list) seen.add(r.id);
        return;
      }
      for (const r of list) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const phrase = r.body ? `${r.title}. ${r.body}` : r.title;
        voice.speak(phrase, {
          voiceName: voiceConfig.voiceName,
          rate: clampRate(voiceConfig.voiceRate),
        });
      }
    } catch {
      /* swallow — offline / transient */
    }
  }, [voice, voiceConfig]);

  // Refresh the device's voice + sleep config on mount and on visibility
  // change so parent toggle updates from their phone propagate without a
  // kiosk reload.
  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/me/device-config", { cache: "no-store" });
      if (!res.ok) return;
      const j = await res.json();
      const d = j?.device;
      if (!d) {
        setVoiceConfig(null);
        return;
      }
      setVoiceConfig({
        voiceReadoutEnabled: Boolean(d.voiceReadoutEnabled),
        voiceName: d.voiceName ?? null,
        voiceRate: typeof d.voiceRate === "number" ? d.voiceRate : 1,
        sleepModeEnabled: Boolean(d.sleepModeEnabled),
        sleepStartTime: typeof d.sleepStartTime === "string" ? d.sleepStartTime : "22:00",
        sleepEndTime: typeof d.sleepEndTime === "string" ? d.sleepEndTime : "07:00",
      });
    } catch {
      /* offline — keep last known config */
    }
  }, []);

  useEffect(() => {
    if (pathname === "/login" || pathname?.startsWith("/screensaver")) return;
    loadConfig();
    poll();
    const id = setInterval(poll, POLL_MS);
    // Re-poll when the tab regains focus.
    const onVis = () => {
      if (!document.hidden) {
        loadConfig();
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll, loadConfig, pathname]);

  async function dismiss(id: string) {
    // Optimistic hide — even if the POST fails, the next poll will re-surface
    // the reminder if it's still unacknowledged.
    setReminders((r) => r.filter((x) => x.id !== id));
    // Stop any in-flight speech for this reminder — if the user dismisses
    // while the kiosk is still talking, cut it off.
    voice.cancel();
    await fetch(`/api/reminders/${id}/acknowledge`, { method: "POST" }).catch(
      () => {},
    );
  }

  if (pathname === "/login" || pathname?.startsWith("/screensaver")) return null;
  if (reminders.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {reminders.map((r) => (
        <div
          key={r.id}
          className="card shadow-lg p-3 pr-2 flex items-start gap-3 border-l-4 border-violet-500 animate-in slide-in-from-right"
          role="alert"
        >
          <Bell
            size={20}
            className="text-violet-500 mt-0.5 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{r.title}</div>
            {r.body && (
              <div className="text-sm muted mt-0.5 whitespace-pre-wrap">
                {r.body}
              </div>
            )}
          </div>
          <button
            className="btn btn-ghost shrink-0"
            onClick={() => dismiss(r.id)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
