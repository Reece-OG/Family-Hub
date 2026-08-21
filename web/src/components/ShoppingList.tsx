"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Eraser,
  Plus,
  Trash2,
  Check,
  FileDown,
  Pencil,
  X,
  ShoppingBasket,
  ListChecks,
  EyeOff,
} from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type Item = {
  id: string;
  name: string;
  quantity: string | null;
  category: string | null;
  done: boolean;
  addedBy: { id: string; name: string; color: string; avatarEmoji: string };
};

// v4.7.19 — reusable catalogue.
type Master = {
  id: string;
  name: string;
  category: string | null;
  defaultQuantity: string | null;
  useCount: number;
  lastUsedAt: string | null;
};

const CATEGORIES = [
  "Produce",
  "Dairy",
  "Bakery",
  "Meat & Fish",
  "Pantry",
  "Frozen",
  "Drinks",
  "Household",
  "Other",
];

type EditDraft = {
  id: string;
  name: string;
  quantity: string;
  category: string;
};

type MasterEditDraft = {
  id: string;
  name: string;
  category: string;
  defaultQuantity: string;
};

type Tab = "list" | "catalog";

export function ShoppingList({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>("list");
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<EditDraft | null>(null);

  // v4.7.17 — auto-refresh on mount, tab focus, and every 30 s so kiosks
  // see new items added by other family members without a manual reload.
  // v5.0.5 — hardened. Reverse-proxy hiccups or a briefly-restarting API
  // would occasionally return non-JSON (an HTML error page from the proxy),
  // .json() would throw, the exception would bubble up through
  // useAutoRefresh's uncaught branch, and the whole /shopping route
  // would render an error screen until the user hard-reloaded. Now we
  // catch the failure, keep the previous items on screen, and let the
  // next 30-s refresh recover on its own.
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/shopping", { cache: "no-store" });
      if (!r.ok) return; // 5xx / 401 during a brief blip — keep last-good items
      const text = await r.text();
      if (!text) return; // empty body from a cold proxy — same treatment
      let j: { items?: Item[] } | null = null;
      try {
        j = JSON.parse(text) as { items?: Item[] };
      } catch {
        return; // non-JSON (proxy error page etc.) — swallow and retry next tick
      }
      setItems(j?.items || []);
    } catch {
      // Network dropped completely (kiosk WiFi flap, iOS PWA backgrounded
      // mid-request). Keep the current list; the visibility-change refresh
      // will re-run when the app returns to the foreground.
    }
  }, []);
  useAutoRefresh(load, { intervalMs: 30_000 });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await fetch("/api/shopping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        quantity: qty.trim() || null,
        category: cat || null,
      }),
    });
    if (res.ok) {
      setName("");
      setQty("");
      setCat("");
      await load();
    }
  }

  async function toggle(it: Item) {
    await fetch(`/api/shopping/${it.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !it.done }),
    });
    await load();
  }
  async function remove(it: Item) {
    if (!confirm("Delete this item?")) return;
    await fetch(`/api/shopping/${it.id}`, { method: "DELETE" });
    await load();
  }

  function beginEdit(it: Item) {
    setEditing({
      id: it.id,
      name: it.name,
      quantity: it.quantity ?? "",
      category: it.category ?? "",
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) {
      alert("Item name cannot be blank.");
      return;
    }
    const res = await fetch(`/api/shopping/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name.trim(),
        quantity: editing.quantity.trim() || null,
        category: editing.category || null,
      }),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Could not save changes");
    }
  }

  const grouped = groupBy(items, (i) => i.category || "Other");
  const tickedCount = useMemo(
    () => items.filter((i) => i.done).length,
    [items],
  );

  // v4.7.6 — bulk-clear ticked items. Hits DELETE /api/shopping/done which
  // wipes everything where done=true and leaves outstanding rows alone.
  async function clearTicked() {
    if (tickedCount === 0) return;
    const noun = tickedCount === 1 ? "item" : "items";
    if (
      !confirm(
        `Remove the ${tickedCount} ticked ${noun} from the list? Outstanding items stay.`,
      )
    )
      return;
    const res = await fetch("/api/shopping/done", { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not clear ticked items");
      return;
    }
    await load();
  }

  return (
    <div>
      {/* v4.7.19 — tab switcher between the active list and the reusable
          catalogue. Keep the tabs visible regardless of edit permission so
          children can still browse the catalog and tap items onto the list
          when they have canEditShopping; with canEdit=false the catalog
          becomes read-only (we just hide the + buttons inside CatalogTab). */}
      <div className="inline-flex rounded-2xl border border-[rgb(var(--border))] p-1 mb-4">
        <button
          type="button"
          onClick={() => setTab("list")}
          className={`px-3 py-1.5 rounded-xl text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
            tab === "list"
              ? "bg-violet-500 text-white"
              : "text-[rgb(var(--muted))] hover:bg-[rgb(var(--surface-2))]"
          }`}
        >
          <ListChecks size={14} /> List
          {items.length > 0 && (
            <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-black/10">
              {items.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("catalog")}
          className={`px-3 py-1.5 rounded-xl text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
            tab === "catalog"
              ? "bg-violet-500 text-white"
              : "text-[rgb(var(--muted))] hover:bg-[rgb(var(--surface-2))]"
          }`}
        >
          <ShoppingBasket size={14} /> Catalog
        </button>
      </div>

      {tab === "list" ? (
        <ListTab
          canEdit={canEdit}
          items={items}
          grouped={grouped}
          tickedCount={tickedCount}
          clearTicked={clearTicked}
          create={create}
          name={name}
          setName={setName}
          qty={qty}
          setQty={setQty}
          cat={cat}
          setCat={setCat}
          toggle={toggle}
          beginEdit={beginEdit}
          remove={remove}
        />
      ) : (
        <CatalogTab canEdit={canEdit} onAdded={load} />
      )}

      {editing && (
        // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
        <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
          <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
            <div className="card w-full max-w-md p-4 sm:p-5 relative my-4 sm:my-8">
              <button
                onClick={() => setEditing(null)}
                className="absolute right-3 top-3 btn btn-ghost"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <h3 className="text-lg font-bold mb-4 pr-10">Edit Item</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Item</label>
                  <input
                    className="input mt-1"
                    value={editing.name}
                    autoFocus
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Quantity</label>
                    <input
                      className="input mt-1"
                      value={editing.quantity}
                      onChange={(e) =>
                        setEditing({ ...editing, quantity: e.target.value })
                      }
                      placeholder="2L"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <select
                      className="select mt-1"
                      value={editing.category}
                      onChange={(e) =>
                        setEditing({ ...editing, category: e.target.value })
                      }
                    >
                      <option value="">None</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveEdit}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List tab — the active shopping list (pre-v4.7.19 behaviour, lifted out so
// we can sit it alongside the new Catalog tab without growing the file too
// hard to follow).
// ---------------------------------------------------------------------------

function ListTab({
  canEdit,
  items,
  grouped,
  tickedCount,
  clearTicked,
  create,
  name,
  setName,
  qty,
  setQty,
  cat,
  setCat,
  toggle,
  beginEdit,
  remove,
}: {
  canEdit: boolean;
  items: Item[];
  grouped: Record<string, Item[]>;
  tickedCount: number;
  clearTicked: () => Promise<void>;
  create: (e: React.FormEvent) => Promise<void>;
  name: string;
  setName: (v: string) => void;
  qty: string;
  setQty: (v: string) => void;
  cat: string;
  setCat: (v: string) => void;
  toggle: (it: Item) => Promise<void>;
  beginEdit: (it: Item) => void;
  remove: (it: Item) => Promise<void>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex-1" />
        {canEdit && (
          <button
            type="button"
            onClick={clearTicked}
            disabled={tickedCount === 0}
            className="btn btn-ghost btn-sm inline-flex items-center"
            title={
              tickedCount === 0
                ? "Nothing ticked yet"
                : `Remove the ${tickedCount} ticked item${tickedCount === 1 ? "" : "s"}`
            }
          >
            <Eraser size={14} /> Clear ticked
            {tickedCount > 0 && (
              <span className="ml-1 text-xs muted">({tickedCount})</span>
            )}
          </button>
        )}
        <a
          href="/api/shopping/pdf"
          className="btn btn-ghost btn-sm inline-flex items-center"
          aria-label="Export shopping list as PDF"
        >
          <FileDown size={14} /> Export PDF
        </a>
      </div>

      {canEdit && (
        <form
          onSubmit={create}
          className="card p-3 mb-4 flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-medium muted">Item</label>
            <input
              className="input mt-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Milk"
            />
          </div>
          <div className="w-28">
            <label className="text-xs font-medium muted">Qty</label>
            <input
              className="input mt-1"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="2L"
            />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium muted">Category</label>
            <select
              className="select mt-1"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              <option value="">None</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            <Plus size={16} /> Add
          </button>
        </form>
      )}

      {Object.keys(grouped).length === 0 ? (
        <p className="muted text-sm">Shopping list is empty. 🎉</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, list]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wider muted font-semibold mb-1">
                {category}
              </div>
              <ul className="space-y-1.5">
                {list.map((i) => (
                  <li
                    key={i.id}
                    className="card p-2.5 flex items-center gap-3"
                  >
                    <button
                      onClick={() => canEdit && toggle(i)}
                      disabled={!canEdit}
                      className={`w-6 h-6 rounded-md border flex items-center justify-center ${
                        i.done
                          ? "bg-green-500 text-white border-green-500"
                          : "border-[rgb(var(--border))]"
                      }`}
                      aria-label={i.done ? "Unmark" : "Mark done"}
                    >
                      {i.done && <Check size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div
                        className={`${i.done ? "line-through muted" : "font-medium"}`}
                      >
                        {i.name}
                        {i.quantity ? ` · ${i.quantity}` : ""}
                      </div>
                      <div className="text-xs muted">
                        Added by {i.addedBy.avatarEmoji} {i.addedBy.name}
                      </div>
                    </div>
                    {canEdit && (
                      <>
                        <button
                          className="btn btn-ghost"
                          onClick={() => beginEdit(i)}
                          aria-label="Edit"
                          title="Edit"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="btn btn-ghost text-red-500"
                          onClick={() => remove(i)}
                          aria-label="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog tab — browseable list of reusable masters. Tapping an item adds it
// to the active shopping list with its remembered category and default
// quantity. Recently-used masters bubble to the top of each group so the
// stuff you actually buy is one tap away.
// ---------------------------------------------------------------------------

function CatalogTab({
  canEdit,
  onAdded,
}: {
  canEdit: boolean;
  onAdded: () => Promise<void>;
}) {
  const [masters, setMasters] = useState<Master[]>([]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"alpha" | "recent">("alpha");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<MasterEditDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newDefaultQty, setNewDefaultQty] = useState("");

  const loadMasters = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("sort", sort);
    const r = await fetch(`/api/shopping/masters?${params.toString()}`);
    const j = await r.json();
    setMasters(j.masters || []);
  }, [q, sort]);

  useAutoRefresh(loadMasters, { intervalMs: 60_000 });

  async function addToList(m: Master) {
    setBusyId(m.id);
    try {
      const res = await fetch(`/api/shopping/from-master/${m.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Could not add to list");
        return;
      }
      await Promise.all([loadMasters(), onAdded()]);
    } finally {
      setBusyId(null);
    }
  }

  async function hideMaster(m: Master) {
    if (
      !confirm(
        `Hide "${m.name}" from the catalog? You can resurface it by adding it again or restoring from settings.`,
      )
    )
      return;
    const res = await fetch(`/api/shopping/masters/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    });
    if (res.ok) await loadMasters();
  }

  async function deleteMaster(m: Master) {
    if (
      !confirm(
        `Permanently delete "${m.name}" from the catalog? This won't remove items already on your list.`,
      )
    )
      return;
    const res = await fetch(`/api/shopping/masters/${m.id}`, {
      method: "DELETE",
    });
    if (res.ok) await loadMasters();
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) {
      alert("Name cannot be blank.");
      return;
    }
    const res = await fetch(`/api/shopping/masters/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name.trim(),
        category: editing.category || null,
        defaultQuantity: editing.defaultQuantity.trim() || null,
      }),
    });
    if (res.ok) {
      setEditing(null);
      await loadMasters();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not save changes");
    }
  }

  async function createMaster(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/shopping/masters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        category: newCategory || null,
        defaultQuantity: newDefaultQty.trim() || null,
      }),
    });
    if (res.ok) {
      setNewName("");
      setNewCategory("");
      setNewDefaultQty("");
      setCreating(false);
      await loadMasters();
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not create master");
    }
  }

  const grouped = useMemo(() => groupBy(masters, (m) => m.category || "Other"), [masters]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex-1 min-w-[180px] max-w-sm">
          {/* v4.8.1 — search icon dropped; it overlapped the placeholder text
              and didn't add any value next to a clearly-labelled input. */}
          <input
            className="input"
            placeholder="Search the catalog"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="select w-36"
          value={sort}
          onChange={(e) => setSort(e.target.value as "alpha" | "recent")}
          aria-label="Sort order"
        >
          <option value="alpha">A → Z by category</option>
          <option value="recent">Recently used</option>
        </select>
        <div className="flex-1" />
        {canEdit && (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus size={14} /> Add master
          </button>
        )}
      </div>

      {canEdit && creating && (
        <form
          onSubmit={createMaster}
          className="card p-3 mb-4 flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs font-medium muted">Item</label>
            <input
              className="input mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Bananas"
              autoFocus
            />
          </div>
          <div className="w-28">
            <label className="text-xs font-medium muted">Default qty</label>
            <input
              className="input mt-1"
              value={newDefaultQty}
              onChange={(e) => setNewDefaultQty(e.target.value)}
              placeholder="6"
            />
          </div>
          <div className="w-40">
            <label className="text-xs font-medium muted">Category</label>
            <select
              className="select mt-1"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              <option value="">None</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">
            <Plus size={16} /> Save
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName("");
              setNewCategory("");
              setNewDefaultQty("");
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {masters.length === 0 ? (
        <p className="muted text-sm">
          {q.trim()
            ? "No matches in the catalog."
            : "Your catalog is empty. Add items from the list, recipes, or the menu — anything you add starts remembering itself here."}
        </p>
      ) : sort === "recent" ? (
        // Flat list when sorting by recency — grouping would defeat the point.
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {masters.map((m) => (
            <MasterRow
              key={m.id}
              m={m}
              canEdit={canEdit}
              busyId={busyId}
              onAdd={addToList}
              onEdit={(m) =>
                setEditing({
                  id: m.id,
                  name: m.name,
                  category: m.category || "",
                  defaultQuantity: m.defaultQuantity || "",
                })
              }
              onHide={hideMaster}
              onDelete={deleteMaster}
            />
          ))}
        </ul>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, list]) => (
            <div key={category}>
              <div className="text-xs uppercase tracking-wider muted font-semibold mb-1">
                {category}
              </div>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {list.map((m) => (
                  <MasterRow
                    key={m.id}
                    m={m}
                    canEdit={canEdit}
                    busyId={busyId}
                    onAdd={addToList}
                    onEdit={(m) =>
                      setEditing({
                        id: m.id,
                        name: m.name,
                        category: m.category || "",
                        defaultQuantity: m.defaultQuantity || "",
                      })
                    }
                    onHide={hideMaster}
                    onDelete={deleteMaster}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
          <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
            <div className="card w-full max-w-md p-4 sm:p-5 relative my-4 sm:my-8">
              <button
                onClick={() => setEditing(null)}
                className="absolute right-3 top-3 btn btn-ghost"
                aria-label="Close"
              >
                <X size={18} />
              </button>
              <h3 className="text-lg font-bold mb-4 pr-10">Edit master</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Name</label>
                  <input
                    className="input mt-1"
                    value={editing.name}
                    autoFocus
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Default qty</label>
                    <input
                      className="input mt-1"
                      value={editing.defaultQuantity}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          defaultQuantity: e.target.value,
                        })
                      }
                      placeholder="2L"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <select
                      className="select mt-1"
                      value={editing.category}
                      onChange={(e) =>
                        setEditing({ ...editing, category: e.target.value })
                      }
                    >
                      <option value="">None</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveEdit}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MasterRow({
  m,
  canEdit,
  busyId,
  onAdd,
  onEdit,
  onHide,
  onDelete,
}: {
  m: Master;
  canEdit: boolean;
  busyId: string | null;
  onAdd: (m: Master) => Promise<void>;
  onEdit: (m: Master) => void;
  onHide: (m: Master) => Promise<void>;
  onDelete: (m: Master) => Promise<void>;
}) {
  const busy = busyId === m.id;
  return (
    <li className="card p-2.5 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{m.name}</div>
        <div className="text-xs muted truncate">
          {m.defaultQuantity ? `${m.defaultQuantity} · ` : ""}
          {m.category || "No category"}
          {m.useCount > 0 ? ` · used ${m.useCount}×` : ""}
        </div>
      </div>
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => onAdd(m)}
            disabled={busy}
            className="btn btn-primary btn-sm"
            title="Add to shopping list"
            aria-label={`Add ${m.name} to shopping list`}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(m)}
            className="btn btn-ghost"
            title="Edit master"
            aria-label={`Edit ${m.name}`}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onHide(m)}
            className="btn btn-ghost"
            title="Hide from catalog"
            aria-label={`Hide ${m.name}`}
          >
            <EyeOff size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(m)}
            className="btn btn-ghost text-red-500"
            title="Delete master"
            aria-label={`Delete ${m.name}`}
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </li>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of arr) {
    const k = key(it);
    (out[k] ??= []).push(it);
  }
  return out;
}
