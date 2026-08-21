"use client";

// v4.9.2 — full Notes page. Sticky-paper aesthetic so the board reads
// like a corkboard rather than yet-another-list. Used by /(app)/notes and
// re-exported by NotesWidget (a compact variant) on the dashboard.

import { useCallback, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { Pencil, Pin, PinOff, Plus, Trash2, X, Check } from "lucide-react";

export type NoteColour = "yellow" | "pink" | "green" | "blue";
const COLOURS: NoteColour[] = ["yellow", "pink", "green", "blue"];

export interface NoteAuthor {
  id: string;
  name: string;
  color: string;
  avatar_emoji: string;
}
export interface Note {
  id: string;
  body: string;
  color: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  author: NoteAuthor;
}

// Paper-look class strings per colour. Always light backgrounds even in
// dark mode — real sticky notes don't go dark. Text is always near-black
// so the contrast holds.
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

// Deterministic tiny rotation per note so the board feels organic. Using
// the last char's code keeps it stable across re-renders (a jittering
// board on every poll would be awful).
function rotationFor(id: string): string {
  if (!id) return "rotate-0";
  const c = id.charCodeAt(id.length - 1);
  const angles = ["-rotate-2", "-rotate-1", "rotate-0", "rotate-1", "rotate-2"];
  return angles[c % angles.length];
}

function normaliseColour(c: string): NoteColour {
  return (COLOURS as readonly string[]).includes(c) ? (c as NoteColour) : "yellow";
}

// "12 min ago" style timestamps — sticky-note vibe wants something cheap
// rather than full datetimes. Falls back to the date once we're past a week.
function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} d ago`;
  return new Date(iso).toLocaleDateString();
}

export interface NotesViewMe {
  id: string;
  role: "PARENT" | "CHILD";
}

export function NotesView({ me }: { me: NotesViewMe }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeBody, setComposeBody] = useState("");
  const [composeColour, setComposeColour] = useState<NoteColour>("yellow");
  const [composePinned, setComposePinned] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notes");
      const j = await r.json();
      setNotes(j.notes || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // 60 s tick matches the cadence of other family-shared widgets (todos,
  // shopping). Visibility-change refresh is the more important one — if
  // someone else posted a note on a different device, the board pulls
  // their note the moment you switch back to this tab.
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
        // Keep colour selection — most users will want consistency.
        await load();
      }
    } finally {
      setPosting(false);
    }
  }

  async function togglePin(n: Note) {
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !n.pinned }),
    });
    await load();
  }
  async function setNoteColour(n: Note, color: NoteColour) {
    await fetch(`/api/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color }),
    });
    await load();
  }
  async function remove(n: Note) {
    if (!confirm("Delete this note?")) return;
    await fetch(`/api/notes/${n.id}`, { method: "DELETE" });
    await load();
  }
  function beginEdit(n: Note) {
    setEditingId(n.id);
    setEditingBody(n.body);
  }
  async function saveEdit() {
    if (!editingId) return;
    const body = editingBody.trim();
    if (!body) {
      setEditingId(null);
      return;
    }
    const res = await fetch(`/api/notes/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      setEditingId(null);
      await load();
    }
  }

  // Server sorts pinned-first then newest, so we trust the order here.
  const orderedNotes = notes;

  function canManage(n: Note): boolean {
    return n.author.id === me.id || me.role === "PARENT";
  }

  return (
    <div>
      <form onSubmit={post} className="card p-3 mb-4 space-y-2">
        <textarea
          className="textarea"
          rows={2}
          placeholder="Stick something to the board — a message, a heads-up, a thought…"
          maxLength={500}
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5">
            {COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setComposeColour(c)}
                className={`w-7 h-7 rounded-md border-2 ${
                  composeColour === c
                    ? "ring-2 ring-offset-1 ring-[rgb(var(--brand))]"
                    : ""
                } ${PAPER[c]}`}
                aria-label={`${c} note`}
                title={`${c} note`}
              />
            ))}
          </div>
          <label
            className="text-sm flex items-center gap-1.5 ml-1 cursor-pointer"
            title="Pinned notes float to the top of the board."
          >
            <input
              type="checkbox"
              checked={composePinned}
              onChange={(e) => setComposePinned(e.target.checked)}
            />
            <Pin size={14} className="muted" />
            Pin
          </label>
          <div className="flex-1" />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!composeBody.trim() || posting}
          >
            <Plus size={14} />
            {posting ? "Posting…" : "Post note"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="muted text-sm">Loading notes…</p>
      ) : orderedNotes.length === 0 ? (
        <p className="muted text-sm italic">
          The board is empty. Be the first to stick something here.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedNotes.map((n) => {
            const colour = normaliseColour(n.color);
            const rotation = rotationFor(n.id);
            const editable = canManage(n);
            const isEditing = editingId === n.id;
            return (
              <li
                key={n.id}
                className={`relative p-4 rounded-md border-2 transform ${rotation} ${PAPER[colour]}`}
              >
                {n.pinned && (
                  <Pin
                    size={18}
                    className="absolute -top-2 -right-1 text-rose-600 drop-shadow"
                    aria-label="Pinned"
                  />
                )}
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      className="textarea"
                      rows={4}
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      maxLength={500}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={14} /> Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={saveEdit}
                      >
                        <Check size={14} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words leading-snug min-h-[3.5rem]">
                    {n.body}
                  </p>
                )}
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div className="text-xs opacity-80 flex items-center gap-1.5">
                    <span aria-hidden>{n.author.avatar_emoji}</span>
                    <span className="font-medium">{n.author.name}</span>
                    <span>· {relativeAgo(n.created_at)}</span>
                  </div>
                  {editable && !isEditing && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => togglePin(n)}
                        aria-label={n.pinned ? "Unpin" : "Pin"}
                        title={n.pinned ? "Unpin" : "Pin"}
                      >
                        {n.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      {/* Colour swatches as inline recolour. Small and
                          discreet — only shown when the user owns the
                          note (or is a parent). */}
                      <div className="hidden sm:flex items-center gap-0.5">
                        {COLOURS.filter((c) => c !== colour).map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setNoteColour(n, c)}
                            className={`w-4 h-4 rounded-sm border ${PAPER[c]}`}
                            aria-label={`Change to ${c}`}
                            title={`Change to ${c}`}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => beginEdit(n)}
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => remove(n)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
