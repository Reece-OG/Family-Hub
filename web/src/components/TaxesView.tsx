"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  ImageIcon,
  Plus,
  Receipt as ReceiptIcon,
  Settings2,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";

// -------------------- Types --------------------

type Category = {
  id: string;
  name: string;
  hint: string | null;
  position: number;
  hidden: boolean;
  isStarter: boolean;
};

type LineItem = {
  id?: string;
  label: string;
  amount: number;
  categoryId: string | null;
  position?: number;
};

type ReceiptRow = {
  id: string;
  vendor: string;
  date: string;
  totalAmount: number | string;
  notes: string | null;
  fileFilename: string | null;
  fileMimeType: string | null;
  fileSizeBytes: number | null;
  lineItems: (LineItem & { id: string })[];
};

type FY = {
  startISO: string;
  endExclusiveISO: string;
  label: string;
  key: number;
};

type Summary = {
  fy: FY;
  grandTotal: number;
  categoryRows: { id: string; name: string; hint: string | null; subtotal: number }[];
  uncategorisedSubtotal: number;
  vehicle: {
    subtotal: number;
    groups: {
      itemId: string;
      itemName: string;
      identifier: string | null;
      subtotal: number;
      recordCount: number;
    }[];
  };
};

// -------------------- Top-level component --------------------

export function TaxesView({
  me,
}: {
  me: { id: string; name: string; role: "PARENT" | "CHILD" };
}) {
  // FY selection — the API resolves "current" when fyKey is null.
  const [fyKey, setFyKey] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ReceiptRow | "new" | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // Inline banner shown when the user clicks Export PDF on an FY with zero
  // claimable spend. Auto-dismisses after a few seconds.
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const fyParam = fyKey != null ? `?fy=${fyKey}` : "";
      const [s, r, c] = await Promise.all([
        fetch(`/api/taxes/summary${fyParam}`).then((r) => r.json()),
        fetch(`/api/taxes/receipts${fyParam}`).then((r) => r.json()),
        fetch("/api/taxes/categories").then((r) => r.json()),
      ]);
      setSummary(s);
      setReceipts(r.receipts || []);
      setCategories(c.categories || []);
    } finally {
      setLoading(false);
    }
  }, [fyKey]);

  // v4.7.17 — refresh on mount + tab focus. Tax data changes slowly so no
  // background polling tick is needed.
  useAutoRefresh(load, { intervalMs: 10 * 60_000 });

  const visibleCategories = useMemo(
    () => categories.filter((c) => !c.hidden),
    [categories],
  );

  function shiftFY(delta: number) {
    const cur = summary?.fy.key ?? new Date().getUTCFullYear();
    setFyKey(cur + delta);
  }

  const exportHref = useMemo(() => {
    const k = summary?.fy.key;
    return k != null ? `/api/taxes/export?fy=${k}` : "/api/taxes/export";
  }, [summary]);

  // v4.7.5 — guard the Export PDF anchor so an empty FY shows a friendly
  // "nothing to export" banner instead of generating a near-empty PDF
  // (and previously crashing on the Content-Disposition encoding).
  function onExportClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!summary) return;
    const total = summary.grandTotal + summary.vehicle.subtotal;
    if (total === 0 && receipts.length === 0) {
      e.preventDefault();
      setExportBanner(
        `Nothing to export yet for ${summary.fy.label}. Add a receipt (or log a vehicle service in Maintenance) and try again.`,
      );
      window.setTimeout(() => setExportBanner(null), 5000);
    }
  }

  return (
    <div>
      {/* ----- Toolbar ----- */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-xl border border-[rgb(var(--border))] overflow-hidden">
          <button
            className="btn btn-ghost btn-sm rounded-none border-0"
            onClick={() => shiftFY(-1)}
            aria-label="Previous financial year"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="px-3 py-1.5 text-xs sm:py-2 sm:text-sm font-semibold flex items-center">
            {summary?.fy.label ?? "FY"}
          </div>
          <button
            className="btn btn-ghost btn-sm rounded-none border-0 border-l border-[rgb(var(--border))]"
            onClick={() => shiftFY(1)}
            aria-label="Next financial year"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setFyKey(null)}
        >
          This FY
        </button>
        <div className="flex-1" />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setManageOpen(true)}
        >
          <Settings2 size={14} /> Categories
        </button>
        <a
          href={exportHref}
          onClick={onExportClick}
          className="btn btn-secondary btn-sm inline-flex items-center"
          title="Download FY summary as PDF"
        >
          <Download size={14} /> Export PDF
        </a>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setEditing("new")}
        >
          <Plus size={14} /> New receipt
        </button>
      </div>

      {exportBanner && (
        <div className="text-sm rounded-xl px-3 py-2 mb-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          {exportBanner}
        </div>
      )}

      {/* ----- Summary card ----- */}
      <SummaryCard summary={summary} loading={loading} />

      {/* ----- Receipt list ----- */}
      <div className="mt-6">
        <h2 className="font-bold mb-2">Receipts in {summary?.fy.label ?? "FY"}</h2>
        {loading ? (
          <p className="muted text-sm">Loading receipts…</p>
        ) : receipts.length === 0 ? (
          <div className="card p-8 text-center">
            <ReceiptIcon className="mx-auto mb-2 text-violet-500" size={36} />
            <p className="font-semibold mb-1">No receipts yet for this FY</p>
            <p className="text-sm muted">
              Tap <span className="font-medium">New receipt</span> to upload a
              PDF/image and tag the items by category. Vehicle service costs
              are pulled in automatically from Maintenance.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {receipts.map((r) => (
              <ReceiptRowView
                key={r.id}
                r={r}
                categories={categories}
                onOpen={() => setEditing(r)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ----- Edit dialog ----- */}
      {editing && (
        <ReceiptDialog
          mode={editing === "new" ? "new" : "edit"}
          initial={editing === "new" ? null : editing}
          categories={visibleCategories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onDeleted={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {/* ----- Manage categories ----- */}
      {manageOpen && (
        <CategoriesDialog
          categories={categories}
          onClose={() => setManageOpen(false)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
  void me;
}

// -------------------- Summary card --------------------

function fmtMoney(v: number) {
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "AUD",
    currencyDisplay: "narrowSymbol",
  });
}

function SummaryCard({
  summary,
  loading,
}: {
  summary: Summary | null;
  loading: boolean;
}) {
  if (!summary) {
    return (
      <div className="card p-4">
        <p className="muted text-sm">{loading ? "Loading…" : "No data."}</p>
      </div>
    );
  }
  const grand = summary.grandTotal + summary.vehicle.subtotal;
  const nonZero = summary.categoryRows.filter((c) => c.subtotal !== 0);
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-3">
        <div>
          <div className="text-xs muted uppercase tracking-wide">
            Claimable in {summary.fy.label}
          </div>
          <div className="text-3xl font-bold">{fmtMoney(grand)}</div>
        </div>
        <div className="text-xs muted">
          Receipts:{" "}
          <span className="font-semibold text-[rgb(var(--text))]">
            {fmtMoney(summary.grandTotal)}
          </span>
          {summary.vehicle.subtotal > 0 && (
            <>
              {"  ·  "}Vehicle (Maintenance):{" "}
              <span className="font-semibold text-[rgb(var(--text))]">
                {fmtMoney(summary.vehicle.subtotal)}
              </span>
            </>
          )}
        </div>
      </div>
      {nonZero.length === 0 && summary.uncategorisedSubtotal === 0 && summary.vehicle.subtotal === 0 ? (
        <p className="text-sm muted">
          No receipts logged yet. Add your first one to start the breakdown.
        </p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {nonZero.map((c) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span className="truncate">{c.name}</span>
              <span className="font-semibold tabular-nums">
                {fmtMoney(c.subtotal)}
              </span>
            </li>
          ))}
          {summary.uncategorisedSubtotal !== 0 && (
            <li className="flex justify-between gap-3 muted">
              <span>Uncategorised</span>
              <span className="font-semibold tabular-nums">
                {fmtMoney(summary.uncategorisedSubtotal)}
              </span>
            </li>
          )}
          {summary.vehicle.subtotal !== 0 && (
            <li className="flex justify-between gap-3">
              <span className="truncate">Vehicle (from Maintenance)</span>
              <span className="font-semibold tabular-nums">
                {fmtMoney(summary.vehicle.subtotal)}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// -------------------- Receipt row --------------------

function ReceiptRowView({
  r,
  categories,
  onOpen,
}: {
  r: ReceiptRow;
  categories: Category[];
  onOpen: () => void;
}) {
  const total = Number(r.totalAmount);
  const lineCount = r.lineItems.length;
  const catNames = useMemo(() => {
    const ids = Array.from(
      new Set(r.lineItems.map((li) => li.categoryId).filter(Boolean) as string[]),
    );
    const byId = new Map(categories.map((c) => [c.id, c.name]));
    return ids.map((id) => byId.get(id) || "Uncategorised");
  }, [r.lineItems, categories]);

  const fileIcon = r.fileMimeType === "application/pdf" ? FileText : ImageIcon;
  const FileIcon = r.fileFilename ? fileIcon : null;

  return (
    <li className="card p-3">
      <button
        className="w-full text-left flex items-center gap-3"
        onClick={onOpen}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{r.vendor}</span>
            <span className="text-xs muted">
              {format(new Date(r.date), "d MMM yyyy")}
            </span>
            {FileIcon && (
              <FileIcon size={14} className="text-violet-500 shrink-0" />
            )}
          </div>
          <div className="text-xs muted mt-0.5">
            {lineCount} item{lineCount === 1 ? "" : "s"}
            {catNames.length > 0 && (
              <>
                {" · "}
                {catNames.slice(0, 3).join(", ")}
                {catNames.length > 3 && ` +${catNames.length - 3}`}
              </>
            )}
          </div>
        </div>
        <div className="font-bold text-lg tabular-nums shrink-0">
          {fmtMoney(total)}
        </div>
      </button>
    </li>
  );
}

// -------------------- Receipt edit dialog --------------------

function toLocalDate(iso: string | null | undefined): string {
  // <input type="date"> expects yyyy-MM-dd in local TZ. Default to today.
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ReceiptDialog({
  mode,
  initial,
  categories,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: "new" | "edit";
  initial: ReceiptRow | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [dateStr, setDateStr] = useState(toLocalDate(initial?.date ?? null));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<LineItem[]>(
    initial?.lineItems.length
      ? initial.lineItems.map((li) => ({
          id: li.id,
          label: li.label,
          amount: Number(li.amount),
          categoryId: li.categoryId,
        }))
      : [{ label: "", amount: 0, categoryId: null }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(Boolean(initial?.fileFilename));
  const [fileMime, setFileMime] = useState(initial?.fileMimeType ?? null);

  const computedTotal = useMemo(
    () =>
      Math.round(items.reduce((acc, it) => acc + (it.amount || 0), 0) * 100) /
      100,
    [items],
  );

  function updateItem(i: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, { label: "", amount: 0, categoryId: null }]);
  }

  function removeItem(i: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function save() {
    setError(null);
    if (!vendor.trim()) return setError("Vendor is required");
    if (!dateStr) return setError("Date is required");
    if (items.length === 0 || items.some((it) => !it.label.trim())) {
      return setError("Every line needs a label");
    }
    if (items.some((it) => Number.isNaN(it.amount))) {
      return setError("Amount must be a number");
    }

    setSaving(true);
    try {
      const body = {
        vendor: vendor.trim(),
        date: new Date(`${dateStr}T00:00:00`).toISOString(),
        notes: notes.trim() || null,
        lineItems: items.map((it) => ({
          ...(it.id ? { id: it.id } : {}),
          label: it.label.trim(),
          amount: it.amount,
          categoryId: it.categoryId,
        })),
      };
      const url = mode === "new" ? "/api/taxes/receipts" : `/api/taxes/receipts/${initial!.id}`;
      const method = mode === "new" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not save receipt");
      }
      // Pending file upload? do it now (only meaningful in new-mode after save).
      const created = await res.json();
      const id: string = created.receipt.id;
      const queued = fileInputRef.current?.files?.[0];
      if (queued) {
        await uploadFile(id, queued);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(receiptId: string, file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/taxes/receipts/${receiptId}/file`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Upload failed");
      }
      const data = await res.json();
      setHasFile(Boolean(data.receipt.fileFilename));
      setFileMime(data.receipt.fileMimeType ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (mode === "edit" && initial) {
      await uploadFile(initial.id, f);
    }
    // In new-mode the file is held until save() completes.
  }

  async function removeFile() {
    if (!initial) return;
    if (!confirm("Remove the attached file?")) return;
    const res = await fetch(`/api/taxes/receipts/${initial.id}/file`, {
      method: "DELETE",
    });
    if (res.ok) {
      setHasFile(false);
      setFileMime(null);
    }
  }

  async function destroy() {
    if (!initial) return;
    if (!confirm(`Delete the receipt from ${initial.vendor}?`)) return;
    const res = await fetch(`/api/taxes/receipts/${initial.id}`, {
      method: "DELETE",
    });
    if (res.ok) onDeleted();
  }

  const fileHref =
    initial && hasFile ? `/api/taxes/receipts/${initial.id}/file` : null;

  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-xl p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold mb-4 pr-10">
          {mode === "new" ? "New Receipt" : "Edit Receipt"}
        </h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Vendor</label>
              <input
                className="input mt-1"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Bunnings, Officeworks, …"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                className="input mt-1"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
          </div>

          {/* File ----------------------------------------------------------- */}
          <div>
            <label className="text-sm font-medium">Receipt file</label>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                className="hidden"
                onChange={onFilePicked}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload size={14} />
                {uploading
                  ? "Uploading…"
                  : hasFile
                  ? "Replace"
                  : mode === "new"
                  ? "Choose file"
                  : "Upload"}
              </button>
              {hasFile && fileHref && (
                <a
                  href={fileHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm inline-flex items-center"
                  title="Open attached file"
                >
                  {fileMime === "application/pdf" ? (
                    <FileText size={14} />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                  View
                </a>
              )}
              {hasFile && initial && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-rose-600 dark:text-rose-300"
                  onClick={removeFile}
                >
                  Remove file
                </button>
              )}
              <span className="text-xs muted">
                PDF, JPEG, PNG, WebP, or GIF · up to 12 MB
              </span>
            </div>
          </div>

          {/* Line items ----------------------------------------------------- */}
          <div>
            <label className="text-sm font-medium">Items on this receipt</label>
            <div className="space-y-2 mt-1">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-end gap-2 flex-wrap sm:flex-nowrap"
                >
                  <div className="flex-1 min-w-[140px]">
                    <input
                      className="input"
                      value={it.label}
                      placeholder="Drill bit set"
                      onChange={(e) => updateItem(i, { label: e.target.value })}
                    />
                  </div>
                  <div className="w-28">
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={Number.isFinite(it.amount) ? it.amount : 0}
                      onChange={(e) =>
                        updateItem(i, {
                          amount: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="w-44">
                    <select
                      className="input"
                      value={it.categoryId ?? ""}
                      onChange={(e) =>
                        updateItem(i, { categoryId: e.target.value || null })
                      }
                    >
                      <option value="">— Uncategorised —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm shrink-0"
                    onClick={() => removeItem(i)}
                    aria-label="Remove line"
                    disabled={items.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addItem}
              >
                <Plus size={14} /> Add another line
              </button>
            </div>
            <div className="text-sm mt-2 flex justify-end gap-2">
              <span className="muted">Total:</span>
              <span className="font-bold tabular-nums">
                {fmtMoney(computedTotal)}
              </span>
            </div>
          </div>

          {/* Notes ---------------------------------------------------------- */}
          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              className="textarea mt-1"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was this for? Any specifics for the accountant?"
            />
          </div>

          {error && (
            <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-5">
          {mode === "edit" ? (
            <button className="btn btn-danger" onClick={destroy}>
              <Trash2 size={16} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={saving || uploading}
              onClick={save}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// -------------------- Categories dialog --------------------

function CategoriesDialog({
  categories,
  onClose,
  onChanged,
}: {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<Category[]>(categories);
  const [newName, setNewName] = useState("");
  const [newHint, setNewHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setList(categories), [categories]);

  async function add() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/taxes/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, hint: newHint || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not add category");
      }
      setNewName("");
      setNewHint("");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(c: Category, patch: Partial<Category>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/taxes/categories/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not update");
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function destroy(c: Category) {
    if (
      !confirm(
        `Delete "${c.name}"? Existing line items in this category will become Uncategorised.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/taxes/categories/${c.id}`, {
        method: "DELETE",
      });
      if (res.ok) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-lg p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold mb-1 pr-10">Tax categories</h3>
        <p className="text-xs muted mb-4">
          Starter list comes from the ATO's "deductions you can claim"
          guidance — feel free to rename, hide, or add your own.
        </p>

        <ul className="space-y-2 mb-4">
          {list.map((c) => (
            <li key={c.id} className="card p-3">
              <div className="flex items-start gap-2">
                <Tag size={14} className="mt-1 text-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <input
                    className="input"
                    value={c.name}
                    onChange={(e) =>
                      setList((prev) =>
                        prev.map((x) =>
                          x.id === c.id ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== categories.find((x) => x.id === c.id)?.name) {
                        patch(c, { name: v } as Partial<Category>);
                      }
                    }}
                  />
                  <input
                    className="input mt-1 text-xs"
                    placeholder="Hint shown next to the name"
                    value={c.hint ?? ""}
                    onChange={(e) =>
                      setList((prev) =>
                        prev.map((x) =>
                          x.id === c.id ? { ...x, hint: e.target.value } : x,
                        ),
                      )
                    }
                    onBlur={(e) =>
                      patch(c, {
                        hint: e.target.value.trim() || null,
                      } as Partial<Category>)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <label className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={c.hidden}
                      onChange={(e) => patch(c, { hidden: e.target.checked })}
                    />
                    Hidden
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-rose-600 dark:text-rose-300"
                    onClick={() => destroy(c)}
                    disabled={busy}
                    aria-label="Delete category"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-[rgb(var(--border))] pt-3">
          <div className="text-sm font-medium mb-2">Add a category</div>
          <div className="flex gap-2 flex-wrap">
            <input
              className="input flex-1 min-w-[140px]"
              placeholder="Name (e.g. Subscriptions)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="input flex-1 min-w-[140px]"
              placeholder="Hint (optional)"
              value={newHint}
              onChange={(e) => setNewHint(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={add}
              disabled={busy || !newName.trim()}
            >
              <Plus size={14} /> Add
            </button>
          </div>
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-300 mt-2">
              {error}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
