"use client";

// v4.9.2 — compact dashboard variant of the Notes board.
//
// Same /api/notes data source as NotesView but with a stripped UI: just
// compose, view, and a "See all" link. Edit / delete / pin live on the
// dedicated /notes page so the widget stays compact even when families
// accumulate dozens of notes.

import { useCallback, useState } from "react";
import Link from "next/link";
import { Pin, Plus } from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type NoteColour = "yellow" | "pink" | "green" | "blue";
const COLOURS: NoteColour[] = ["yellow", "pink", "green", "blue"];

const PAPER: Record<NoteColour, string> = {
  yellow:
    "bg-[#fff3a3] border-[#f1d76b] text-[#3a2e0a] shadow-[0_2px_6px_rgba(0,0,0,0.25)]",
  pink:
    "bg-[#ffb9d0] border-[#f494b4] text-[#3a0a23] shadow-[0_2px_6px_rgba(0,0,0,0.25)]",
  green:
    "bg-[#b6f0c2] border-[#85d699] text-[#0a3a1a] shadow-[0_2px_6px_rgba(0,0,0,0.25)]",
  blue:
    "bg-[#b0e0ff] border-[#7cc4f0] text-[#0a263a] shadow-[0_2px_6px_rgba(0,0,0,0.25)]",
};

function rotationFor(id: string): string {
  if (!id) return "rotate-0";
  const c = id.charCodeAt(id.length - 1);
  // Smaller rotation range than the full board — the widget is denser so
  // big tilts would crowd the grid.
  const angles = ["-rotate-1", "rotate-0", "rotate-1"];
  return angles[c % angles.length];
}

function normaliseColour(c: string): NoteColour {
  return (COLOURS as readonly string[]).includes(c) ? (c as NoteColour) : "yellow";
}

function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString();
}

interface Note {
  id: string;
  body: string;
  color: string;
  pinned: boolean;
  created_at: string;
  author: { id: string; name: string; color: string; avatar_emoji: string };
}

export function NotesWidget() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeBody, setComposeBody] = useState("");
  const [composeColour, setComposeColour] = useState<NoteColour>("yellow");
  const [composePinned, setComposePinned] = useState(false);
  const [posting, setPosting] = useState(false);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notes?limit=6");
      const j = await r.json();
      setNotes(j.notes || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useAutoRefresh(load, { intervalMs: 60_000 });

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const body = composeBody.trim();
    if (!body) return;
    setPosting(true);
    try {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          color: composeColour,
          pinned: composePinned,
        }),
      });
      if (r.ok) {
        setComposeBody("");
        setComposePinned(false);
        setComposing(false);
        await load();
      }
    } finally {
      setPosting(false);
    }
  }

  // Widget hides itself entirely when the user has no notes AND hasn't
  // opened the compose row. Keeps the dashboard from being weighed down
  // by an empty board on day one — the "Post a note" affordance still
  // appears so the user can start the first one.
  const showBoard = notes.length > 0;

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg">Family Notes</h2>
        <div className="flex items-center gap-3">
          {!composing && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setComposing(true)}
            >
              <Plus size={14} /> Post a note
            </button>
          )}
          <Link href="/notes" className="text-sm muted hover:underline">
            See all →
          </Link>
        </div>
      </div>

      {composing && (
        <form onSubmit={post} className="space-y-2">
          <textarea
            className="textarea"
            rows={2}
            placeholder="Quick note for the family…"
            maxLength={500}
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1.5">
              {COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setComposeColour(c)}
                  className={`w-6 h-6 rounded-md border-2 ${
                    composeColour === c
                      ? "ring-2 ring-offset-1 ring-[rgb(var(--brand))]"
                      : ""
                  } ${PAPER[c]}`}
                  aria-label={`${c} note`}
                  title={`${c} note`}
                />
              ))}
            </div>
            <label className="text-xs flex items-center gap-1.5 ml-1 cursor-pointer">
              <input
                type="checkbox"
                checked={composePinned}
                onChange={(e) => setComposePinned(e.target.checked)}
              />
              <Pin size={12} className="muted" /> Pin
            </label>
            <div className="flex-1" />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setComposing(false);
                setComposeBody("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!composeBody.trim() || posting}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
        </form>
      )}

      {!showBoard ? (
        loading ? (
          <p className="muted text-sm">Loading…</p>
        ) : (
          <p className="muted text-sm italic">
            The board is empty. Post a note to start the conversation.
          </p>
        )
      ) : (
        <ul className="grid gap-3 grid-cols-2 md:grid-cols-3">
          {notes.slice(0, 6).map((n) => {
            const colour = normaliseColour(n.color);
            const rotation = rotationFor(n.id);
            return (
              <li
                key={n.id}
                className={`relative p-3 rounded-md border-2 transform ${rotation} ${PAPER[colour]} text-sm`}
              >
                {n.pinned && (
                  <Pin
                    size={14}
                    className="absolute -top-1.5 -right-1 text-rose-600 drop-shadow"
                    aria-label="Pinned"
                  />
                )}
                <p className="whitespace-pre-wrap break-words leading-snug line-clamp-4 min-h-[3rem]">
                  {n.body}
                </p>
                <div className="mt-2 text-[11px] opacity-80 flex items-center gap-1.5">
                  <span aria-hidden>{n.author.avatar_emoji}</span>
                  <span className="font-medium truncate">{n.author.name}</span>
                  <span>· {relativeAgo(n.created_at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
