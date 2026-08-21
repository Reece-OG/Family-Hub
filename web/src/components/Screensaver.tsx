"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { WeatherOverlay } from "./WeatherWidget";

type Photo = {
  id: string;
  filename: string;
  caption: string | null;
  createdAt: string;
};

// Fisher-Yates shuffle — used to randomise photo order when the user turns on
// the shuffle setting. Returns a new array so we don't mutate state directly.
function shuffled<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function Screensaver({
  intervalMs,
  shuffle = false,
  exitOnInput = true,
  showWeather = false,
}: {
  intervalMs: number;
  shuffle?: boolean;
  exitOnInput?: boolean;
  // v4.7 — weather now has independent toggles for home vs. screensaver. The
  // page reads the setting and passes the effective boolean in so the overlay
  // only renders when the user actually wants it on the kiosk.
  showWeather?: boolean;
}) {
  const router = useRouter();
  const [rawPhotos, setRawPhotos] = useState<Photo[]>([]);
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Tracks whether we've already started processing an exit event — without
  // this, any-input mode can fire navigate() several times in quick
  // succession (mousemove + keydown + touchstart all land in the same tick).
  const exitingRef = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/photos").then((r) => r.json());
    setRawPhotos(r.photos || []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    // Re-pull the photo list every five minutes so newly-uploaded pictures
    // appear without needing to reload.
    const refreshId = setInterval(load, 5 * 60_000);
    return () => clearInterval(refreshId);
  }, [load]);

  // Build the effective display order once per photo-list change (and again
  // whenever shuffle flips). Reshuffling on every index tick would make
  // navigation feel broken.
  const photos = useMemo(
    () => (shuffle ? shuffled(rawPhotos) : rawPhotos),
    [rawPhotos, shuffle],
  );

  // Advance the slideshow.
  useEffect(() => {
    if (photos.length <= 1) return;
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % photos.length);
    }, Math.max(1000, intervalMs));
    return () => clearInterval(id);
  }, [photos.length, intervalMs]);

  // Clock — once per minute is plenty for an HH:mm display and keeps the
  // overlay from flickering every second.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Reset the index if the photo list shrinks (or a reshuffle moved things
  // around).
  useEffect(() => {
    if (idx >= photos.length) setIdx(0);
  }, [idx, photos.length]);

  // Defensive: ensure the user's chosen theme survives the full-screen
  // screensaver. Without this, some setups (Android Chrome PWA, certain SW
  // navigation paths) can drop the `dark` class on <html> when transitioning
  // back into the app, leaving the user staring at a light-mode dashboard.
  // We re-apply on mount and again on unmount so the post-exit screen always
  // matches what the user originally chose.
  useEffect(() => {
    const applyStoredTheme = () => {
      try {
        const stored = window.localStorage.getItem("familyhub-theme");
        const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const useDark = stored ? stored === "dark" : sysDark;
        document.documentElement.classList.toggle("dark", useDark);
      } catch {
        /* localStorage / matchMedia unavailable — leave class alone. */
      }
    };
    applyStoredTheme();
    return applyStoredTheme;
  }, []);

  // Any-input exit. User asked for keyboard + mouse + touch to bail out. We
  // navigate back in the history stack so the user lands on whatever they
  // were last looking at, falling back to /dashboard when there's no
  // history entry (hard-reload case).
  //
  // v5.0.1 — grace period before attaching the listeners. The kiosk has
  // an "Activate screensaver" button in its sidebar; clicking it routes
  // to /screensaver, this useEffect runs, mousemove was already
  // attached → fires the moment the click finishes (mouse is still
  // moving) → router.back() → user is bounced straight back to the
  // dashboard. Half a second was enough to reproduce the bug; 1500 ms
  // is comfortable cover for the user's tail-of-click hand motion
  // without making the screensaver feel sticky on the auto-launch
  // path (where they've been idle for minutes anyway).
  useEffect(() => {
    if (!exitOnInput) return;
    const exit = () => {
      if (exitingRef.current) return;
      exitingRef.current = true;
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
      } else {
        router.push("/dashboard");
      }
    };
    // Passive listeners where it's safe so the browser doesn't wait on us
    // before scrolling etc.
    const opts: AddEventListenerOptions = { passive: true };
    let attached = false;
    const attach = () => {
      window.addEventListener("keydown", exit, opts);
      window.addEventListener("mousedown", exit, opts);
      window.addEventListener("mousemove", exit, opts);
      window.addEventListener("wheel", exit, opts);
      window.addEventListener("touchstart", exit, opts);
      window.addEventListener("touchmove", exit, opts);
      window.addEventListener("pointerdown", exit, opts);
      attached = true;
    };
    const handle = setTimeout(attach, 1500);
    return () => {
      clearTimeout(handle);
      if (attached) {
        window.removeEventListener("keydown", exit);
        window.removeEventListener("mousedown", exit);
        window.removeEventListener("mousemove", exit);
        window.removeEventListener("wheel", exit);
        window.removeEventListener("touchstart", exit);
        window.removeEventListener("touchmove", exit);
        window.removeEventListener("pointerdown", exit);
      }
    };
  }, [exitOnInput, router]);

  const current = photos[idx];

  // Kiosk styling: the outer shell is black (as requested — "happy if this
  // goes in a black border"), and the photo is rendered inside a smaller
  // inset container so the border is always visible. object-contain keeps
  // the full frame regardless of aspect ratio.
  return (
    <div
      ref={containerRef}
      className="fixed inset-0 bg-black text-white overflow-hidden select-none"
    >
      {/* v4.9.4 — photo frame given a bit more height by trimming the top
          band from 16vh to 10vh. The clock typography below was rebased
          to match the weather overlay's font sizes (text-3xl temp,
          text-xs condition), so the band needs less vertical room. */}
      <div className="absolute inset-[10vh_8vw_8vh_8vw] rounded-2xl overflow-hidden bg-black">
        <PhotoStack current={current} loaded={loaded} />
      </div>

      {/* v4.9.4 — clock typography rebased to match the WeatherOverlay on
          the right: text-3xl for the primary number, text-xs for the
          secondary line. The two sides now read as one banner. */}
      <div className="absolute top-[3vh] left-[6vw] drop-shadow-lg flex items-baseline gap-3 text-white">
        <div className="text-3xl font-extrabold tabular-nums leading-none">
          {format(now, "HH:mm")}
        </div>
        <div className="text-xs opacity-80">
          <div className="font-semibold leading-tight">
            {format(now, "EEEE")}
          </div>
          <div className="leading-tight">{format(now, "d MMM yyyy")}</div>
        </div>
      </div>

      {/* Top-right: weather overlay sits at the same vertical position as
          the clock so the two read as one band. */}
      {showWeather && (
        <div className="absolute top-[3vh] right-[6vw]">
          <WeatherOverlay />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// v4.9.4 — cross-fade photo stack.
//
// Previously each photo swap was abrupt: React swapped the <img>'s key, the
// old img was removed in one frame, the new one appeared in the next. Now we
// maintain a stack of layers, each in either "entering" or "leaving" state.
// New layers mount at opacity 0 and animate to their target opacity over
// 500 ms via a CSS transition (the transition fires because the opacity
// classes change after a requestAnimationFrame tick). Leaving layers ramp
// back to opacity 0 and are pruned 600 ms later.
//
// The result is a brisk cross-fade rather than a hard cut. 500 ms is just
// long enough to register as "smooth" without dragging on a slideshow that
// changes every few seconds.
// ---------------------------------------------------------------------------

// v4.9.8 — bumped from 500 ms to 1500 ms after user feedback that the
// quicker fade felt glitchy on kiosks. 1.5 s reads as a slow, deliberate
// dissolve rather than a hard cut. Prune window sits a hair longer than
// the fade so leaving layers always finish their animation before they're
// removed from the DOM.
const FADE_MS = 1500;
const PRUNE_MS = 1700;

type StackLayer = {
  key: number;
  photo: Photo;
  leaving: boolean;
};

function PhotoStack({
  current,
  loaded,
}: {
  current: Photo | undefined;
  loaded: boolean;
}) {
  const [layers, setLayers] = useState<StackLayer[]>([]);
  const nextKeyRef = useRef(1);

  useEffect(() => {
    if (!current) {
      // No current photo (empty library or initial paint before fetch).
      // Mark everything as leaving so the screen fades to black instead
      // of holding the last photo forever.
      setLayers((prev) => prev.map((l) => ({ ...l, leaving: true })));
      return;
    }
    setLayers((prev) => {
      // If the topmost layer is already this photo, no-op. Guards against
      // React strict-mode double-effects and clock ticks that trigger an
      // unrelated re-render without changing current.
      const top = prev[prev.length - 1];
      if (top && !top.leaving && top.photo.id === current.id) return prev;
      const key = nextKeyRef.current++;
      return [
        ...prev.map((l) => ({ ...l, leaving: true })),
        { key, photo: current, leaving: false },
      ];
    });
  }, [current]);

  // Periodically prune fully-faded leaving layers so the stack never grows
  // unboundedly on long sessions.
  useEffect(() => {
    if (layers.every((l) => !l.leaving)) return;
    const t = setTimeout(() => {
      setLayers((prev) => prev.filter((l) => !l.leaving));
    }, PRUNE_MS);
    return () => clearTimeout(t);
  }, [layers]);

  if (layers.length === 0) {
    return loaded ? (
      <div className="h-full flex items-center justify-center text-center px-8">
        <div>
          <div className="text-3xl font-bold mb-3">No photos yet</div>
          <p className="opacity-70">
            Upload photos on the Photos page — they&apos;ll appear here.
          </p>
        </div>
      </div>
    ) : null;
  }

  return (
    <>
      {layers.map((layer) => (
        <PhotoLayer key={layer.key} photo={layer.photo} leaving={layer.leaving} />
      ))}
    </>
  );
}

function PhotoLayer({ photo, leaving }: { photo: Photo; leaving: boolean }) {
  // v4.9.8 — we wait for the foreground image to ACTUALLY LOAD before
  // we start the fade-in. The previous implementation fired the
  // mount-time RAF immediately, so on slow kiosk Wi-Fi the layer faded
  // in an empty box and then the photo popped in later when the bytes
  // arrived. Gating on onLoad turns the cross-fade into a real
  // cross-fade of two decoded images.
  //
  // The double-rAF guard exists because a single requestAnimationFrame
  // callback can be batched into the same paint as the initial commit on
  // some browsers (notably Firefox on Linux, which is where this kiosk
  // class lives). Two RAFs guarantees the browser has committed
  // opacity-0 to the DOM before we flip to opacity-1 — without that
  // the CSS transition never fires and you get a hard cut.
  //
  // v4.9.9 — wrapper-opacity rewrite. Previously bg + fg each had their
  // own opacity transition running on each of two layers during a
  // cross-fade — four animated opacities at once, with one of them
  // mutating a blur-2xl element (40 px blur radius). On kiosk-class
  // hardware (Raspberry Pi, NUC, etc.) the CPU was being asked to
  // re-rasterise a 40 px gaussian blur every frame because the layout
  // engine isn't certain a blurred element's compositing can be cached
  // across opacity changes. The result: visible jitter during the fade.
  //
  // New shape: bg + fg sit inside a single wrapper div, and we animate
  // the WRAPPER'S opacity. Each layer is now one compositing surface
  // instead of two. We also hint the browser via will-change: opacity
  // and transform: translateZ(0) (the GPU "Z-promotion" trick) so the
  // wrapper gets its own GPU layer that's composited cheaply. Finally,
  // the blur is dialled back from blur-2xl (40 px) to blur-xl (24 px) —
  // visually similar at letterbox edges, materially cheaper per frame.
  const [visible, setVisible] = useState(false);

  // The browser may serve cached photos synchronously (img.complete is
  // true the instant the element mounts), in which case onLoad never
  // fires. Detect that on mount and kick the transition off ourselves.
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (imgRef.current?.complete) startFadeIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startFadeIn() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });
  }

  // Single opacity on the wrapper. Children keep their relative weights
  // (the blurred backdrop sits at 0.45 of the wrapper, the foreground at
  // full). CSS opacity is multiplicative so a wrapper at 0.5 + a child
  // at 0.45 = effective 0.225 — the backdrop ramps up smoothly along
  // with the wrapper.
  const opacity = leaving || !visible ? 0 : 1;
  // ease-in-out reads more symmetric than ease-out for this length of
  // dissolve — old layer's drop-off and new layer's ramp meet roughly in
  // the middle of the transition window, which is what you want for a
  // cross-fade.
  const wrapperStyle: React.CSSProperties = {
    opacity,
    transition: `opacity ${FADE_MS}ms ease-in-out`,
    // GPU promotion hints. willChange tells the compositor "this layer
    // will animate opacity, give it its own surface"; translateZ(0)
    // forces that surface to actually exist on browsers that ignore
    // will-change. Cheap because the surface is bounded by the layer's
    // size, not the photo's native resolution.
    willChange: "opacity",
    transform: "translateZ(0)",
  };
  const src = `/api/photos/file/${encodeURIComponent(photo.filename)}`;

  return (
    <div className="absolute inset-0" style={wrapperStyle}>
      {/* Blurred backdrop for letterboxed photos. decoding="async" hints
          the browser to decode off the main thread so the fade doesn't
          drop frames while a 12 MP photo is being unpacked. blur-xl
          (24 px) is cheaper to rasterise than blur-2xl (40 px) but
          visually comparable at letterbox-fill scale. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-40"
      />
      {/* Foreground photo. The onLoad on this one drives the fade-in
          for the whole wrapper — both bg + fg share the same src so they
          share the browser's cache hit. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={photo.caption ?? "Family photo"}
        decoding="async"
        onLoad={startFadeIn}
        className="absolute inset-0 w-full h-full object-contain"
      />
    </div>
  );
}
