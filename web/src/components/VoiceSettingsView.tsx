"use client";

// v4.9.5 — kiosk-side voice picker.
//
// Lists every voice the kiosk's own browser knows about (grouped by
// language so the family doesn't have to scroll through 50+ Apple voices
// to find the one they want). Each row has a Preview button so the user
// can hear it before saving. Rate slider with a live preview. The Test
// button at the top plays a longer sample to verify the final config.
//
// Saves go to /api/me/device-config (no parent password needed; the
// device cookie is enough). The voice picker has to run on the actual
// kiosk because the available voices are browser-specific — picking
// "Karen" on a parent's phone is no guarantee that "Karen" exists on
// the kitchen tablet.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Play, Save, Volume2 } from "lucide-react";
import { useVoiceReadout, clampRate } from "@/lib/use-voice-readout";

interface DeviceConfig {
  voiceReadoutEnabled: boolean;
  voiceName: string | null;
  voiceRate: number;
}

const PREVIEW_SENTENCE =
  "Reminder: School pickup in 15 minutes. This is Family Hub.";
const SHORT_PREVIEW_PREFIX = "Hi, this is";

export function VoiceSettingsView({
  deviceId,
  deviceName,
}: {
  deviceId: string;
  deviceName: string;
}) {
  const voice = useVoiceReadout();
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull the current LocalDevice config on mount via the public device-
  // config endpoint. This survives a parent-side change between sessions.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/device-config")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const d = j?.device;
        if (!d) return;
        setConfig({
          voiceReadoutEnabled: Boolean(d.voiceReadoutEnabled),
          voiceName: d.voiceName ?? null,
          voiceRate: typeof d.voiceRate === "number" ? d.voiceRate : 1,
        });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load voice settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<DeviceConfig>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/me/device-config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j?.error || "Save failed");
          return;
        }
        const j = await res.json();
        setConfig((prev) =>
          prev
            ? {
                voiceReadoutEnabled: Boolean(j.device.voiceReadoutEnabled),
                voiceName: j.device.voiceName ?? null,
                voiceRate:
                  typeof j.device.voiceRate === "number"
                    ? j.device.voiceRate
                    : 1,
              }
            : prev,
        );
        setSavedAt(new Date());
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  if (!voice.isSupported) {
    return (
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Volume2 size={20} />
          <h2 className="font-bold text-lg">Voice readout not available</h2>
        </div>
        <p className="muted text-sm">
          This browser doesn&apos;t support the Web Speech API. Voice readout
          is supported in modern Chrome, Edge, Safari and Firefox. If
          you&apos;re on a kiosk, try updating its browser.
        </p>
      </div>
    );
  }

  // Voices arrive asynchronously — show a skeleton until at least one
  // arrives. (Chromium sometimes returns [] on the first synchronous call
  // before firing voiceschanged with the real list.)
  if (!config) {
    return <p className="muted text-sm">Loading settings…</p>;
  }

  // Group voices by primary language so the dropdown stays scannable.
  // Most users pick once based on their language anyway.
  const groups = new Map<string, typeof voice.voices>();
  for (const v of voice.voices) {
    const key = (v.lang || "?").split("-")[0].toLowerCase() || "?";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }
  const sortedKeys = Array.from(groups.keys()).sort();

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Volume2 size={20} />
          <h2 className="font-bold text-lg">{deviceName} voice settings</h2>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={config.voiceReadoutEnabled}
            disabled={saving}
            onChange={(e) =>
              save({ voiceReadoutEnabled: e.target.checked })
            }
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">
              Read reminders aloud on this kiosk
            </div>
            <div className="text-xs muted mt-0.5">
              When a reminder fires, this device will announce the title and
              body using the voice you choose below. Suppressed during the
              device&apos;s night-sleep window.
            </div>
          </div>
        </label>

        <div>
          <label className="text-sm font-medium">Speaking rate</label>
          <div className="flex items-center gap-3 mt-1">
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={config.voiceRate}
              disabled={saving || !config.voiceReadoutEnabled}
              onChange={(e) =>
                setConfig((c) =>
                  c ? { ...c, voiceRate: Number(e.target.value) } : c,
                )
              }
              onMouseUp={() =>
                save({ voiceRate: clampRate(config.voiceRate) })
              }
              onTouchEnd={() =>
                save({ voiceRate: clampRate(config.voiceRate) })
              }
              className="flex-1"
            />
            <span className="tabular-nums text-sm w-12 text-right">
              {config.voiceRate.toFixed(2)}×
            </span>
          </div>
          <div className="text-xs muted mt-1">
            0.5× is half speed, 2× is double. Most TTS engines sound natural
            around 1.0–1.2.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-primary btn-sm inline-flex items-center"
            onClick={() =>
              voice.preview(PREVIEW_SENTENCE, {
                voiceName: config.voiceName,
                rate: config.voiceRate,
              })
            }
            disabled={!config.voiceReadoutEnabled}
          >
            <Play size={14} />
            Test voice
          </button>
          {!voice.isPrimed && config.voiceReadoutEnabled && (
            <span className="text-xs muted">
              Tap Test to enable voice on this kiosk (browsers require one
              tap before they&apos;ll speak).
            </span>
          )}
          {savedAt && !saving && (
            <span className="text-xs text-emerald-600 dark:text-emerald-300 inline-flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
          {saving && <span className="text-xs muted">Saving…</span>}
        </div>

        {error && (
          <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-bold">Choose a voice</h3>
        <p className="muted text-xs">
          Voices available on this kiosk only. Use <strong>Preview</strong>{" "}
          to hear a voice, then <strong>Use this</strong> to save it.
        </p>

        {!voice.isReady ? (
          <p className="muted text-sm">Loading voices…</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-start gap-3 rounded-xl border border-[rgb(var(--border))] p-3 cursor-pointer">
              <input
                type="radio"
                name="voice"
                className="mt-1"
                checked={!config.voiceName}
                onChange={() => save({ voiceName: null })}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">System default</div>
                <div className="text-xs muted mt-0.5">
                  Whatever voice the browser picks. Safe fallback.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.preventDefault();
                  voice.preview(PREVIEW_SENTENCE, {
                    voiceName: null,
                    rate: config.voiceRate,
                  });
                }}
              >
                <Play size={14} /> Preview
              </button>
            </label>

            {sortedKeys.map((lang) => {
              const list = (groups.get(lang) ?? []).slice().sort((a, b) => {
                if (a.localService !== b.localService) {
                  return a.localService ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
              });
              return (
                <section key={lang}>
                  <div className="text-xs font-semibold muted uppercase tracking-wider mb-1">
                    {lang === "?" ? "Other" : lang}
                  </div>
                  <ul className="space-y-1.5">
                    {list.map((v) => {
                      const isSelected = config.voiceName === v.name;
                      return (
                        <li
                          key={`${v.name}-${v.lang}`}
                          className={`rounded-xl border p-2.5 flex items-center gap-3 ${
                            isSelected
                              ? "border-[rgb(var(--brand))] bg-[rgb(var(--brand))]/5"
                              : "border-[rgb(var(--border))]"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {v.name}
                              {v.isDefault && (
                                <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded-full bg-[rgb(var(--surface-2))] muted">
                                  browser default
                                </span>
                              )}
                              {!v.localService && (
                                <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-[rgb(var(--surface-2))] muted">
                                  online
                                </span>
                              )}
                            </div>
                            <div className="text-xs muted">{v.lang}</div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              voice.preview(
                                `${SHORT_PREVIEW_PREFIX} ${v.name}. ${PREVIEW_SENTENCE}`,
                                {
                                  voiceName: v.name,
                                  rate: config.voiceRate,
                                },
                              )
                            }
                            title="Preview"
                          >
                            <Play size={14} /> Preview
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${
                              isSelected ? "btn-primary" : "btn-secondary"
                            }`}
                            onClick={() => save({ voiceName: v.name })}
                            disabled={saving}
                            title="Use this voice"
                          >
                            {isSelected ? (
                              <>
                                <Check size={14} /> Selected
                              </>
                            ) : (
                              <>
                                <Save size={14} /> Use this
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <p className="text-xs muted pt-2">
          Want to change the on/off toggle from your phone? It&apos;s also in{" "}
          <Link href="/settings" className="underline">
            Settings → Local Devices
          </Link>{" "}
          on a parent account.
        </p>
      </div>
    </div>
  );
}
