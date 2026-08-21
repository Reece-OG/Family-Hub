"use client";

import { useEffect, useRef } from "react";

// Vibrant flowing-blob background.
//
// Designed to feel like the user's reference images: a deep black base with
// large luminous coloured blobs that slowly drift and morph. Pure canvas
// (no deps), uses additive blending so where blobs overlap the colours
// fuse into bright highlights — gives that "light through smoke" quality.
// Renders at the device's full pixel ratio (capped at 3) so it stays crisp
// on high-DPI / 4K kiosk screens.

const PALETTE = [
  "#ff006e", // hot pink
  "#ff5c8d", // soft pink
  "#ff8a3d", // orange
  "#ffd23f", // yellow
  "#8bd346", // lime
  "#06d6a0", // mint green
  "#2bd9fe", // cyan
  "#3a86ff", // electric blue
  "#8338ec", // violet
  "#f15bb5", // magenta
];

type Blob = {
  baseX: number;
  baseY: number;
  driftX: number;
  driftY: number;
  baseR: number;
  morphR: number;
  color: string;
  phaseX: number;
  phaseY: number;
  phaseR: number;
  speedX: number;
  speedY: number;
  speedR: number;
};

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

// Append a 2-char alpha to a "#rrggbb" colour. Inputs always 7 chars.
function withAlpha(hex: string, alpha: string) {
  return `${hex}${alpha}`;
}

export function PaintSplash() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext("2d");
    if (!ctx) return;
    // Capture into a non-null-typed local so the closures below keep the
    // narrowed type (function declarations are hoisted, which causes TS to
    // lose the narrowing from the guard above).
    const g: CanvasRenderingContext2D = ctx;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let stopped = false;
    let blobs: Blob[] = [];
    let cssW = 0;
    let cssH = 0;

    function buildBlobs(w: number, h: number) {
      const minDim = Math.min(w, h);
      // More blobs on bigger screens.
      const count = Math.max(7, Math.round(Math.sqrt(w * h) / 220));
      const colors = [...PALETTE].sort(() => Math.random() - 0.5);
      blobs = Array.from({ length: count }).map((_, i) => {
        const baseR = rand(minDim * 0.32, minDim * 0.62);
        return {
          baseX: rand(0, w),
          baseY: rand(0, h),
          driftX: rand(w * 0.18, w * 0.4),
          driftY: rand(h * 0.18, h * 0.4),
          baseR,
          morphR: baseR * rand(0.18, 0.32),
          color: colors[i % colors.length],
          phaseX: Math.random() * Math.PI * 2,
          phaseY: Math.random() * Math.PI * 2,
          phaseR: Math.random() * Math.PI * 2,
          speedX: rand(0.05, 0.11) * (Math.random() < 0.5 ? -1 : 1),
          speedY: rand(0.05, 0.11) * (Math.random() < 0.5 ? -1 : 1),
          speedR: rand(0.06, 0.14),
        };
      });
    }

    const resize = () => {
      // Full device pixel ratio so blobs render crisply on retina / 4K
      // monitors (cap at 3 to keep GPU memory reasonable on phones).
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cssW = canvas.offsetWidth || window.innerWidth;
      cssH = canvas.offsetHeight || window.innerHeight;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBlobs(cssW, cssH);
    };
    resize();
    window.addEventListener("resize", resize);

    const drawBlob = (b: Blob, t: number) => {
      const x = b.baseX + Math.sin(b.phaseX + t * b.speedX) * b.driftX;
      const y = b.baseY + Math.cos(b.phaseY + t * b.speedY) * b.driftY;
      const r = b.baseR + Math.sin(b.phaseR + t * b.speedR) * b.morphR;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, withAlpha(b.color, "FF"));
      grad.addColorStop(0.35, withAlpha(b.color, "AA"));
      grad.addColorStop(0.7, withAlpha(b.color, "33"));
      grad.addColorStop(1, withAlpha(b.color, "00"));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };

    const paintFrame = (seconds: number) => {
      // Solid black base every frame — no smearing.
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#05060c";
      g.fillRect(0, 0, cssW, cssH);
      // Additive blend for luminous overlap.
      g.globalCompositeOperation = "lighter";
      for (const b of blobs) drawBlob(b, seconds);
      g.globalCompositeOperation = "source-over";
    };

    let start: number | null = null;
    const tick = (now: number) => {
      if (stopped) return;
      if (start === null) start = now;
      paintFrame((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };

    if (prefersReduced) {
      paintFrame(0);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="paint-canvas" aria-hidden="true" />;
}
