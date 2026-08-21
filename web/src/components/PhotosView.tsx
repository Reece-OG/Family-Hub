"use client";

import { useCallback, useRef, useState } from "react";
import { format } from "date-fns";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  Camera,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type Photo = {
  id: string;
  filename: string;
  caption: string | null;
  createdAt: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: { id: string; name: string; avatarEmoji: string };
};

// v4.8.2 — multi-photo upload queue. Each picked file gets its own row so
// the user can see progress per-photo and which one (if any) failed.
type UploadRow = {
  id: string;
  name: string;
  size: number;
  progress: number; // 0..100
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

// v4.9.3 — expanded MIME set. HEIC / HEIF are iPhone defaults; without
// them, iOS users selecting from the Photos app silently lose every file
// (the picker hands us files with type "image/heic" which the old list
// rejected). The server-side ALLOWED_PHOTO_MIME has been widened to
// match. We still reject everything else (PDFs, videos, …) with a
// visible error so the user isn't left guessing.
const MIME_ALLOW = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

// Extension fallback for files where the browser surfaces an empty MIME
// string (iCloud-stored photos sometimes do this on iOS). We map a small
// set of extensions back to the canonical image type so the file is
// still accepted and the server gets a sensible mimeType column.
const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

// Coerce a File into a {file, type} pair where `type` is one of MIME_ALLOW
// or null if the file isn't a supported image. Browsers occasionally
// report a blank `file.type` (notably iOS for iCloud assets); we look at
// the extension as a fallback in that case so the user still gets to
// upload their photo.
function classifyFile(file: File): { type: string; file: File } | null {
  const declared = (file.type || "").toLowerCase();
  if (MIME_ALLOW.includes(declared)) return { type: declared, file };
  const dot = file.name.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = file.name.slice(dot + 1).toLowerCase();
  const fallback = EXT_TO_MIME[ext];
  if (!fallback) return null;
  // Re-wrap with the inferred MIME so FormData sends a sensible
  // Content-Type. Browsers happily preserve the original blob bytes here.
  const retyped = new File([file], file.name, { type: fallback });
  return { type: fallback, file: retyped };
}

function rowId() {
  // No crypto.randomUUID polyfill needed — this only runs in modern browsers
  // that support fetch+FormData anyway. Math.random suffix is plenty since
  // these IDs are only used as React keys.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function PhotosView({
  canManage,
}: {
  canManage: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [caption, setCaption] = useState("");
  const [viewer, setViewer] = useState<Photo | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragging, setDragging] = useState(false);
  // v4.9.3 — surface "X files were skipped" so the user understands why
  // their HEIC / PDF / 1GB video didn't upload instead of staring at an
  // empty upload list.
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const r = await fetch("/api/photos").then((r) => r.json());
      setPhotos(r.photos || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // v4.7.17 — refresh on mount, tab focus, and a slow 5-minute tick.
  // Photos change less frequently than to-dos or shopping items.
  useAutoRefresh(load, { intervalMs: 5 * 60_000 });

  // v4.8.2 — single-file uploader factored out of the change handler so the
  // multi-select picker AND the drop zone can both feed it. Uses
  // XMLHttpRequest because fetch() doesn't expose upload progress events;
  // we want the per-file progress bar to creep up while the network is
  // working, otherwise large family photos look hung.
  const uploadOne = useCallback(
    (file: File, row: UploadRow, sharedCaption: string) =>
      new Promise<void>((resolve) => {
        const fd = new FormData();
        fd.append("file", file);
        if (sharedCaption.trim()) fd.append("caption", sharedCaption.trim());

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/photos");
        xhr.upload.addEventListener("progress", (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploads((prev) =>
            prev.map((u) =>
              u.id === row.id ? { ...u, progress: pct, status: "uploading" } : u,
            ),
          );
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploads((prev) =>
              prev.map((u) =>
                u.id === row.id ? { ...u, progress: 100, status: "done" } : u,
              ),
            );
          } else {
            let msg = "Upload failed";
            try {
              const parsed = JSON.parse(xhr.responseText);
              if (parsed?.error) msg = parsed.error;
            } catch {
              /* ignore */
            }
            setUploads((prev) =>
              prev.map((u) =>
                u.id === row.id
                  ? { ...u, status: "error", error: msg, progress: 100 }
                  : u,
              ),
            );
          }
          resolve();
        });
        xhr.addEventListener("error", () => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === row.id
                ? { ...u, status: "error", error: "Network error", progress: 100 }
                : u,
            ),
          );
          resolve();
        });
        xhr.send(fd);
      }),
    [],
  );

  const handleFiles = useCallback(
    async (raw: FileList | File[]) => {
      const incoming = Array.from(raw);
      // v4.9.3 — classify each file: keep supported images (with MIME or
      // extension), surface a notice for anything else. Previously this
      // path silently dropped everything that wasn't an exact MIME match,
      // which made the whole feature look broken on iPhone (HEIC) and
      // on iCloud-stored photos (empty MIME).
      const classified: { type: string; file: File }[] = [];
      const rejected: string[] = [];
      for (const f of incoming) {
        const c = classifyFile(f);
        if (c) classified.push(c);
        else rejected.push(f.name);
      }

      if (rejected.length > 0) {
        setFilterNotice(
          `Skipped ${rejected.length} unsupported file${rejected.length === 1 ? "" : "s"} (${rejected
            .slice(0, 3)
            .join(", ")}${rejected.length > 3 ? ", …" : ""}). Supported: JPEG, PNG, WebP, GIF, HEIC.`,
        );
      } else {
        setFilterNotice(null);
      }

      const files = classified.map((c) => c.file);
      if (files.length === 0) return;

      // Snapshot the caption at the moment the user kicks off the batch —
      // multi-uploads share a caption, which matches how cameras work
      // (a single "kitchen, Easter Sunday" describing the whole burst).
      const sharedCaption = caption;
      const rows: UploadRow[] = files.map((f) => ({
        id: rowId(),
        name: f.name,
        size: f.size,
        progress: 0,
        status: "pending",
      }));
      setUploads((prev) => [...prev, ...rows]);

      // Parallel uploads but with a small concurrency cap so we don't
      // saturate the LXC's network on a 50-photo batch. 4 at a time is a
      // sweet spot for the typical Wi-Fi → home server pipe.
      const CONCURRENCY = 4;
      const queue = rows.map((r, i) => ({ row: r, file: files[i] }));
      let cursor = 0;
      async function worker() {
        while (cursor < queue.length) {
          const idx = cursor++;
          const { row, file } = queue[idx];
          await uploadOne(file, row, sharedCaption);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker),
      );

      // Clear caption (we used it) and refresh the grid so successful
      // uploads appear immediately.
      setCaption("");
      await load();
    },
    [caption, load, uploadOne],
  );

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    // v4.9.3 — snapshot to a stable array BEFORE resetting the input.
    // Previously we held a reference to the live FileList and then set
    // `value = ""`, which clears the input's FileList — so by the time
    // handleFiles ran, `files` was empty and the upload silently no-op'd.
    // This was the user-visible bug: "select files, hit upload, nothing
    // happens".
    const snapshot: File[] = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // allow re-selecting the same file
    if (snapshot.length === 0) return;
    await handleFiles(snapshot);
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (!canManage) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    await handleFiles(e.dataTransfer.files);
  }

  async function remove(p: Photo) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/photos/${p.id}`, { method: "DELETE" });
    if (viewer?.id === p.id) setViewer(null);
    await load();
  }

  // Are any uploads still in flight? Used to disable the picker button so
  // a user doesn't queue a second batch on top of a first that's still
  // chewing through 80 photos.
  const busy = uploads.some((u) => u.status === "uploading" || u.status === "pending");

  function clearFinished() {
    setUploads((prev) => prev.filter((u) => u.status === "uploading" || u.status === "pending"));
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4 space-y-3">
          <input
            className="input"
            placeholder="Caption (optional — applied to every photo in this batch)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          {/* v4.8.2 — drop-zone doubles as a click target for the hidden
              <input>. Touch users tap, desktop users either tap or drag. */}
          <div
            onClick={() => !busy && fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`card p-6 text-center cursor-pointer border-2 border-dashed transition-colors ${
              dragging
                ? "border-violet-500 bg-violet-500/10"
                : "border-[rgb(var(--border))] hover:bg-[rgb(var(--surface-2))]"
            } ${busy ? "opacity-60 cursor-wait" : ""}`}
            role="button"
            tabIndex={0}
            aria-label="Upload photos"
          >
            <input
              ref={fileInput}
              type="file"
              // v4.9.3 — accept HEIC + HEIF too. Without these listed,
              // iOS's photo picker greys out the iPhone's default-format
              // photos. We also list the extensions explicitly so iCloud
              // files that come back with a blank MIME aren't filtered
              // out by the OS picker.
              accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif"
              multiple
              className="hidden"
              onChange={onFileChange}
            />
            <Upload className="mx-auto mb-2 text-violet-500" size={28} />
            <div className="font-medium">
              {dragging
                ? "Drop to upload"
                : busy
                  ? "Uploading…"
                  : "Drop photos here or tap to choose"}
            </div>
            <div className="text-xs muted mt-1">
              JPEG, PNG, WebP, GIF or HEIC · multiple files OK
            </div>
          </div>

          {/* v4.9.3 — visible notice when files were filtered out so the
              user understands why their PDF / video / unrecognised type
              didn't upload. Auto-clears on the next pick. */}
          {filterNotice && (
            <div className="text-sm rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
              {filterNotice}
            </div>
          )}

          {uploads.length > 0 && (
            <div className="card p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  Uploads ({uploads.filter((u) => u.status === "done").length} /{" "}
                  {uploads.length})
                </div>
                {!busy && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearFinished}
                  >
                    Clear
                  </button>
                )}
              </div>
              <ul className="space-y-2">
                {uploads.map((u) => (
                  <li key={u.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 truncate">{u.name}</div>
                      <div className="muted shrink-0">{humanSize(u.size)}</div>
                      {u.status === "done" && (
                        <CheckCircle2
                          size={14}
                          className="text-emerald-500 shrink-0"
                        />
                      )}
                      {u.status === "error" && (
                        <span className="text-rose-500 shrink-0">Failed</span>
                      )}
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full overflow-hidden bg-[rgb(var(--surface-2))]">
                      <div
                        className={`h-full transition-[width] duration-150 ${
                          u.status === "error"
                            ? "bg-rose-500"
                            : u.status === "done"
                              ? "bg-emerald-500"
                              : "bg-violet-500"
                        }`}
                        style={{ width: `${u.progress}%` }}
                      />
                    </div>
                    {u.error && (
                      <div className="text-rose-500 mt-0.5">{u.error}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1" />
        <a
          href="/screensaver"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm"
        >
          <ExternalLink size={14} />
          Open screensaver
        </a>
      </div>

      {loading ? (
        <p className="muted text-sm">Loading photos…</p>
      ) : photos.length === 0 ? (
        <div className="card p-8 text-center">
          <Camera className="mx-auto mb-2 text-violet-500" size={36} />
          <p className="font-semibold mb-1">No photos yet</p>
          <p className="text-sm muted">
            {canManage
              ? "Upload family photos — they'll appear on the screensaver."
              : "Parents can upload photos here."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="card overflow-hidden group relative">
              <button
                onClick={() => setViewer(p)}
                className="block w-full"
                aria-label="Open photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/photos/file/${encodeURIComponent(p.filename)}`}
                  alt={p.caption ?? "Family photo"}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />
              </button>
              {canManage && (
                <button
                  className="absolute top-2 right-2 btn btn-ghost bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => remove(p)}
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <div className="p-2 text-xs">
                <div className="truncate font-medium">
                  {p.caption || (
                    <span className="muted italic">No caption</span>
                  )}
                </div>
                <div className="muted flex items-center gap-1 mt-0.5">
                  <span>{p.uploadedBy.avatarEmoji}</span>
                  <span className="truncate">
                    {format(new Date(p.createdAt), "d MMM yyyy")}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <button
            className="absolute top-4 right-4 btn btn-ghost text-white"
            onClick={() => setViewer(null)}
            aria-label="Close"
          >
            <X size={24} />
          </button>
          <figure
            className="max-w-5xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/file/${encodeURIComponent(viewer.filename)}`}
              alt={viewer.caption ?? "Family photo"}
              className="w-full max-h-[85vh] object-contain rounded-xl"
            />
            {(viewer.caption || viewer.uploadedBy.name) && (
              <figcaption className="text-white text-center mt-3 text-sm flex items-center justify-center gap-2">
                <ImageIcon size={14} />
                {viewer.caption && <span>{viewer.caption}</span>}
                <span className="opacity-70">
                  · {viewer.uploadedBy.avatarEmoji} {viewer.uploadedBy.name}
                  {" · "}
                  {format(new Date(viewer.createdAt), "d MMM yyyy")}
                </span>
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </div>
  );
}
