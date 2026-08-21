"use client";

// v4.9.5 — Web Speech API helpers.
//
// useVoiceReadout() is the shared hook that:
//   • Enumerates available voices via window.speechSynthesis.getVoices().
//     Voice lists load asynchronously on some browsers (Chrome especially)
//     so we also listen for the voiceschanged event.
//   • Tracks whether the API is "primed" — Safari/iOS require a user-gesture
//     -driven utterance before subsequent programmatic speak() calls fire.
//     The voice settings page calls preview() during a button click to
//     prime; after that, ReminderToaster can speak silently from a timer.
//   • Exposes speak(text, { name, rate }) which builds a
//     SpeechSynthesisUtterance, looks up the named voice by exact match
//     then by case-insensitive contains, falls back to the system default.
//   • Always returns gracefully on browsers without the API (server, old
//     mobile browsers). isSupported reports false and speak() is a no-op.
//
// This file is client-only ("use client" at the top). Server components
// must not import it.

import { useCallback, useEffect, useState } from "react";

export interface VoiceInfo {
  name: string;
  lang: string;
  // Voices flagged as default by the browser. Useful when grouping the UI.
  isDefault: boolean;
  // Browser-supplied flag for voices that run on the user's device rather
  // than a remote endpoint. Local voices have lower latency and don't
  // hit a network; we surface this so the picker can prefer them.
  localService: boolean;
}

export interface SpeakOptions {
  voiceName?: string | null;
  rate?: number;
}

export interface UseVoiceReadoutResult {
  isSupported: boolean;
  // Becomes true once we've successfully fetched at least one voice. The
  // settings UI uses this to know when to render the voice list.
  isReady: boolean;
  voices: VoiceInfo[];
  // Most browsers require speech to be "primed" by an utterance fired
  // during a user gesture. We track that internally; consumers don't
  // need to deal with it directly beyond calling preview() once from a
  // click handler on the settings page.
  isPrimed: boolean;
  speak: (text: string, options?: SpeakOptions) => void;
  preview: (text: string, options?: SpeakOptions) => void;
  cancel: () => void;
}

// Constrain a user-provided rate value to the range the SpeechSynthesis
// spec accepts. Numbers outside [0.1, 10] are silently coerced by the
// browser but we clamp tighter (0.5 - 2.0) to keep the audio intelligible.
export function clampRate(rate: number | null | undefined): number {
  const n = typeof rate === "number" && Number.isFinite(rate) ? rate : 1;
  return Math.max(0.5, Math.min(2, n));
}

// Resolve a voice name string to a SpeechSynthesisVoice. Exact name match
// first (case-sensitive — the spec treats voice names as opaque keys),
// then case-insensitive substring as a fallback (so "Karen" still finds
// "Karen (Australia)" if the OS renamed it). Null means "browser default".
function resolveVoice(
  name: string | null | undefined,
  list: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (!name) return null;
  const exact = list.find((v) => v.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return list.find((v) => v.name.toLowerCase().includes(lower)) ?? null;
}

export function useVoiceReadout(): UseVoiceReadoutResult {
  const [isSupported, setIsSupported] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [isPrimed, setIsPrimed] = useState(false);
  const [rawVoices, setRawVoices] = useState<SpeechSynthesisVoice[]>([]);

  // Refresh voices on mount + every voiceschanged event. The first call to
  // getVoices() often returns an empty list on Chromium; the engine fires
  // voiceschanged once the list is hydrated. Listening for both means we
  // pick up voices regardless of which engine the user is on.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    setIsSupported(true);
    const refresh = () => {
      const list = window.speechSynthesis.getVoices() ?? [];
      setRawVoices(list);
      setVoices(
        list.map((v) => ({
          name: v.name,
          lang: v.lang,
          isDefault: v.default,
          localService: v.localService,
        })),
      );
    };
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  const speakInternal = useCallback(
    (text: string, options: SpeakOptions | undefined, fromGesture: boolean) => {
      if (typeof window === "undefined") return;
      if (!("speechSynthesis" in window)) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        // Cancel any in-flight utterance first. On a busy kiosk with two
        // reminders firing close together, queueing piles up; we'd rather
        // the newest reminder takes over.
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(trimmed);
        u.rate = clampRate(options?.rate ?? 1);
        const voice = resolveVoice(options?.voiceName ?? null, rawVoices);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        }
        window.speechSynthesis.speak(u);
        if (fromGesture) setIsPrimed(true);
      } catch {
        // Safari occasionally throws if the API is in a weird state after
        // backgrounding. Swallow — a missed utterance is non-fatal.
      }
    },
    [rawVoices],
  );

  // speak() is the silent-background variant used by the reminder toaster.
  // preview() is identical but additionally marks the API primed (callers
  // should invoke it from a click handler on iOS / Safari).
  const speak = useCallback(
    (text: string, options?: SpeakOptions) => speakInternal(text, options, false),
    [speakInternal],
  );
  const preview = useCallback(
    (text: string, options?: SpeakOptions) => speakInternal(text, options, true),
    [speakInternal],
  );

  const cancel = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* swallow */
    }
  }, []);

  return {
    isSupported,
    isReady: voices.length > 0,
    voices,
    isPrimed,
    speak,
    preview,
    cancel,
  };
}
