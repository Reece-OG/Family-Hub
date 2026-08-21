"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  endOfWeek,
  format,
  isSameDay,
  startOfWeek,
} from "date-fns";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  Lightbulb,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { useCookMode } from "@/lib/use-cook-mode";

type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";

type RecipeMini = {
  id: string;
  title: string;
  servings: number | null;
  ingredients: {
    id: string;
    name: string;
    quantity: string | null;
    unit: string | null;
  }[];
};

type MenuEntry = {
  id: string;
  date: string;
  mealType: MealType;
  position: number;
  recipeId: string | null;
  freeformTitle: string | null;
  notes: string | null;
  recipe: RecipeMini | null;
};

const MEALS: { type: MealType; label: string; hint: string }[] = [
  { type: "BREAKFAST", label: "Breakfast", hint: "🥐" },
  { type: "LUNCH", label: "Lunch", hint: "🥪" },
  { type: "DINNER", label: "Dinner", hint: "🍝" },
  { type: "SNACK", label: "Snack", hint: "🍎" },
];

function isoDay(d: Date) {
  // Serialize the calendar day in UTC so the server maps it to the same row.
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  ).toISOString();
}

export function MenuView({
  canEdit,
  weekStartsOn = 1,
}: {
  canEdit: boolean;
  weekStartsOn?: 0 | 1;
}) {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn }),
  );
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const [recipes, setRecipes] = useState<RecipeMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{
    date: Date;
    mealType: MealType;
  } | null>(null);
  const [busyBuild, setBusyBuild] = useState(false);

  // If the setting toggles after mount, snap the cursor back to "this week"
  // using the new anchor so users don't end up in an awkward mid-week offset.
  useEffect(() => {
    setWeekStart((prev) => startOfWeek(prev, { weekStartsOn }));
  }, [weekStartsOn]);

  const weekEnd = useMemo(
    () => endOfWeek(weekStart, { weekStartsOn }),
    [weekStart, weekStartsOn],
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const load = useCallback(async () => {
    // v4.7.18 — DO NOT toggle `loading` true here. The initial useState(true)
    // covers the first paint; subsequent auto-refresh ticks must keep the
    // existing data on screen, otherwise the grid blinks back to
    // "Loading menu…" every visibility change / 60-s tick and looks exactly
    // like the data was wiped (this is what users reported on v4.7.17).
    try {
      const [m, r] = await Promise.all([
        fetch(
          `/api/menu?from=${encodeURIComponent(isoDay(weekStart))}&to=${encodeURIComponent(isoDay(weekEnd))}`,
        ).then((r) => r.json()),
        fetch("/api/recipes").then((r) => r.json()),
      ]);
      setEntries(m.entries || []);
      setRecipes(r.recipes || []);
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  // v4.7.17 — auto-refresh on mount, tab focus, and a 60-s tick.
  useAutoRefresh(load, { intervalMs: 60_000 });

  function entriesFor(day: Date, meal: MealType): MenuEntry[] {
    return entries
      .filter(
        (e) => e.mealType === meal && isSameDay(new Date(e.date), day),
      )
      .sort((a, b) => a.position - b.position);
  }

  async function buildShoppingList() {
    if (
      !confirm(
        "Add all ingredients from this week's recipes to the shopping list?",
      )
    )
      return;
    setBusyBuild(true);
    try {
      const res = await fetch("/api/menu/to-shopping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: isoDay(weekStart),
          to: isoDay(weekEnd),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "Could not build shopping list");
      } else {
        alert(
          `Added ${d.added} new items (${d.scanned} total ingredients scanned).`,
        );
      }
    } finally {
      setBusyBuild(false);
    }
  }

  const shoppingPdfHref = `/api/menu/shopping-pdf?from=${encodeURIComponent(isoDay(weekStart))}&to=${encodeURIComponent(isoDay(weekEnd))}`;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          className="btn btn-ghost"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="font-semibold">
          {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM yyyy")}
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          aria-label="Next week"
        >
          <ChevronRight size={18} />
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() =>
            setWeekStart(startOfWeek(new Date(), { weekStartsOn }))
          }
        >
          This week
        </button>
        <div className="flex-1" />
        <a
          href={shoppingPdfHref}
          className="btn btn-ghost btn-sm inline-flex items-center"
          title="Download shopping list PDF for this week's menu"
        >
          <FileDown size={14} /> Shopping PDF
        </a>
        {canEdit && (
          <button
            className="btn btn-primary btn-sm"
            onClick={buildShoppingList}
            disabled={busyBuild}
          >
            <ShoppingCart size={14} />
            Build shopping list
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted text-sm">Loading menu…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((d) => {
            const isToday = isSameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={`card p-3 flex flex-col gap-2 ${
                  isToday ? "ring-2 ring-violet-500" : ""
                }`}
              >
                <div className="font-bold">
                  <div className="text-xs muted uppercase tracking-wide">
                    {format(d, "EEE")}
                  </div>
                  <div>{format(d, "d MMM")}</div>
                </div>
                {MEALS.map((m) => {
                  const slotEntries = entriesFor(d, m.type);
                  return (
                    <button
                      key={m.type}
                      className="text-left rounded-xl border border-[rgb(var(--border))] p-2 hover:bg-[rgb(var(--surface-2))] transition-colors"
                      onClick={() =>
                        (canEdit || slotEntries.length > 0) &&
                        setEditing({
                          date: d,
                          mealType: m.type,
                        })
                      }
                      disabled={!canEdit && slotEntries.length === 0}
                    >
                      <div className="text-xs muted flex items-center gap-1">
                        <span>{m.hint}</span>
                        <span>{m.label}</span>
                        {slotEntries.length > 1 && (
                          <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-700 dark:text-violet-300">
                            {slotEntries.length}
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-semibold min-h-[1.25rem]">
                        {slotEntries.length === 0 ? (
                          canEdit ? (
                            <span className="muted font-normal">+ add</span>
                          ) : (
                            <span className="muted font-normal">—</span>
                          )
                        ) : (
                          <ul className="space-y-0.5">
                            {slotEntries.map((entry) => (
                              <li key={entry.id} className="leading-snug">
                                {entry.recipe?.title ??
                                  entry.freeformTitle ??
                                  "Untitled"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <SlotDialog
          day={editing.date}
          mealType={editing.mealType}
          slotEntries={entriesFor(editing.date, editing.mealType)}
          recipes={recipes}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function SlotDialog({
  day,
  mealType,
  slotEntries,
  recipes,
  canEdit,
  onClose,
  onChanged,
}: {
  day: Date;
  mealType: MealType;
  slotEntries: MenuEntry[];
  recipes: RecipeMini[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [recipeId, setRecipeId] = useState<string>("");
  const [freeform, setFreeform] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // v4.7.6 — auto-engage Cook Mode while this slot pop-over is open. The
  // user opening tonight's dinner card on the kitchen kiosk is a strong
  // signal they're cooking; lock the screen awake and pause the
  // screensaver / night cover until the dialog is closed.
  const cook = useCookMode();
  useEffect(() => {
    cook.enable();
    return () => {
      cook.disable();
    };
    // We deliberately only enable on mount + disable on unmount; the hook
    // identities are stable enough for this lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setRecipeId("");
    setFreeform("");
    setNotes("");
  }

  async function addEntry() {
    if (!recipeId && !freeform.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: isoDay(day),
          mealType,
          recipeId: recipeId || null,
          freeformTitle: recipeId ? null : freeform.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "Could not add");
        return;
      }
      resetForm();
      await onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function removeEntry(id: string) {
    if (!confirm("Remove this item from the slot?")) return;
    const res = await fetch(`/api/menu/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Could not remove item");
      return;
    }
    await onChanged();
  }

  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-md p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold pr-10">
          {MEALS.find((m) => m.type === mealType)?.label} ·{" "}
          {format(day, "EEE d MMM")}
        </h3>
        <p className="text-sm muted mb-2">
          Add as many items as you like — great for parties or picky eaters.
        </p>
        {cook.active && (
          <div className="text-xs rounded-xl px-2.5 py-1.5 mb-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 inline-flex items-center gap-1.5">
            <Lightbulb size={12} />
            Cook Mode on — screen will stay awake while this is open.
          </div>
        )}

        {slotEntries.length > 0 && (
          <ul className="space-y-1 mb-4">
            {slotEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-lg border border-[rgb(var(--border))] px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {entry.recipe?.title ?? entry.freeformTitle}
                  </div>
                  {entry.notes && (
                    <div className="text-xs muted mt-0.5 line-clamp-2">
                      {entry.notes}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <button
                    className="btn btn-ghost text-red-500"
                    onClick={() => removeEntry(entry.id)}
                    aria-label="Remove item"
                    title="Remove item"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <div className="space-y-3 border-t border-[rgb(var(--border))] pt-4">
            <div className="text-sm font-semibold">Add another</div>
            <div>
              <label className="text-sm font-medium">Recipe</label>
              <select
                className="input mt-1"
                value={recipeId}
                onChange={(e) => {
                  setRecipeId(e.target.value);
                  if (e.target.value) setFreeform("");
                }}
              >
                <option value="">— none —</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Or one-off meal</label>
              <input
                className="input mt-1"
                placeholder="Leftovers, takeaway…"
                value={freeform}
                onChange={(e) => {
                  setFreeform(e.target.value);
                  if (e.target.value) setRecipeId("");
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <textarea
                rows={2}
                className="textarea mt-1"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <button
                className="btn btn-primary"
                onClick={addEntry}
                disabled={submitting || (!recipeId && !freeform.trim())}
              >
                <Plus size={16} /> Add to slot
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end mt-4">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
