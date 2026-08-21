"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChefHat,
  Clock,
  Download,
  Flame,
  Image as ImageIcon,
  Lightbulb,
  Plus,
  ShoppingCart,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { useCookMode } from "@/lib/use-cook-mode";

type Ingredient = {
  id?: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  category: string | null;
  position?: number;
};

type Recipe = {
  id: string;
  title: string;
  description: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  // v4.5-and-earlier URL. Kept so legacy rows still render; new uploads clear
  // this in favour of the uploaded file (`imageFilename`).
  imageUrl: string | null;
  imageFilename: string | null;
  caloriesTotal: number | null;
  caloriesPerServing: number | null;
  instructions: string;
  tags: string | null;
  ingredients: Ingredient[];
  createdBy: { id: string; name: string; avatarEmoji: string };
};

type EditForm = {
  id?: string;
  title: string;
  description: string;
  servings: string;
  prepMinutes: string;
  cookMinutes: string;
  // Existing stored filename (if any); used to show the current photo.
  imageFilename: string | null;
  // Newly-picked File from the <input type=file>. Uploaded after save().
  imageFile: File | null;
  // Preview data-URL for the picked file — shown before the recipe row exists.
  imagePreview: string | null;
  caloriesTotal: string;
  caloriesPerServing: string;
  instructions: string;
  tags: string;
  ingredients: Ingredient[];
};

// Cache-buster appended to <img src> so replacing a recipe image forces a
// refetch — the browser would otherwise keep showing the stale upload.
function recipeImageUrl(r: Pick<Recipe, "id" | "imageFilename" | "imageUrl">) {
  if (r.imageFilename) {
    return `/api/recipes/${r.id}/image?v=${encodeURIComponent(r.imageFilename)}`;
  }
  if (r.imageUrl) return r.imageUrl;
  return null;
}

export function RecipesView({
  canEdit,
  canEditShopping,
}: {
  canEdit: boolean;
  // v4.7.19 — separate permission so kids with view-only recipe access can
  // still tap "+ to shopping list" if they're allowed to edit the list.
  canEditShopping: boolean;
}) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditForm | null>(null);

  // v5.0.7 — on narrow viewports the list and detail stack vertically, so
  // picking a recipe pushes the detail below the entire list. Users had to
  // scroll all the way past the list to actually see what they'd just tapped,
  // which got progressively worse as the recipe count grew. We scroll the
  // detail panel into view on selection when the viewport is below
  // Tailwind's `lg` breakpoint (1024 px). On lg+ the two-column layout puts
  // the detail beside the list already, so no scroll is needed.
  const detailRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    if (typeof window === "undefined") return;
    // Match Tailwind's lg breakpoint. Below it, the grid collapses to one
    // column and the detail lives below the list.
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    // Wait a frame so the newly-selected detail has actually been rendered
    // before we try to scroll to it.
    requestAnimationFrame(() => {
      const el = detailRef.current;
      if (el && "scrollIntoView" in el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, [selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = query
        ? `/api/recipes?q=${encodeURIComponent(query)}`
        : "/api/recipes";
      const r = await fetch(url).then((r) => r.json());
      setRecipes(r.recipes || []);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(load, query ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const selected = useMemo(
    () => recipes.find((r) => r.id === selectedId) ?? null,
    [recipes, selectedId],
  );

  function openNew() {
    setEditing({
      title: "",
      description: "",
      servings: "",
      prepMinutes: "",
      cookMinutes: "",
      imageFilename: null,
      imageFile: null,
      imagePreview: null,
      caloriesTotal: "",
      caloriesPerServing: "",
      instructions: "",
      tags: "",
      ingredients: [{ name: "", quantity: "", unit: "", category: "" }],
    });
  }

  function openEdit(r: Recipe) {
    setEditing({
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      servings: r.servings?.toString() ?? "",
      prepMinutes: r.prepMinutes?.toString() ?? "",
      cookMinutes: r.cookMinutes?.toString() ?? "",
      imageFilename: r.imageFilename,
      imageFile: null,
      imagePreview: null,
      caloriesTotal: r.caloriesTotal?.toString() ?? "",
      caloriesPerServing: r.caloriesPerServing?.toString() ?? "",
      instructions: r.instructions ?? "",
      tags: r.tags ?? "",
      ingredients:
        r.ingredients.length > 0
          ? r.ingredients.map((i) => ({
              name: i.name,
              quantity: i.quantity ?? "",
              unit: i.unit ?? "",
              category: i.category ?? "",
            }))
          : [{ name: "", quantity: "", unit: "", category: "" }],
    });
  }

  async function save() {
    if (!editing) return;
    const body = {
      title: editing.title.trim(),
      description: editing.description.trim() || null,
      servings: editing.servings ? Number(editing.servings) : null,
      prepMinutes: editing.prepMinutes ? Number(editing.prepMinutes) : null,
      cookMinutes: editing.cookMinutes ? Number(editing.cookMinutes) : null,
      instructions: editing.instructions,
      tags: editing.tags.trim() || null,
      caloriesTotal: editing.caloriesTotal ? Number(editing.caloriesTotal) : null,
      caloriesPerServing: editing.caloriesPerServing
        ? Number(editing.caloriesPerServing)
        : null,
      ingredients: editing.ingredients
        .filter((i) => i.name.trim())
        .map((i, pos) => ({
          name: i.name.trim(),
          quantity: i.quantity?.toString().trim() || null,
          unit: i.unit?.toString().trim() || null,
          category: i.category?.toString().trim() || null,
          position: pos,
        })),
    };
    const res = await fetch(
      editing.id ? `/api/recipes/${editing.id}` : "/api/recipes",
      {
        method: editing.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not save recipe");
      return;
    }
    const d = await res.json();
    const recipeId: string | undefined = d.recipe?.id;

    // Upload any newly-picked photo, then refresh.
    if (recipeId && editing.imageFile) {
      const fd = new FormData();
      fd.append("file", editing.imageFile);
      const up = await fetch(`/api/recipes/${recipeId}/image`, {
        method: "POST",
        body: fd,
      });
      if (!up.ok) {
        const ud = await up.json().catch(() => ({}));
        alert(ud.error || "Recipe saved, but image upload failed");
      }
    }

    setEditing(null);
    await load();
    if (recipeId) setSelectedId(recipeId);
  }

  async function remove(r: Recipe) {
    if (!confirm(`Delete “${r.title}”?`)) return;
    await fetch(`/api/recipes/${r.id}`, { method: "DELETE" });
    if (selectedId === r.id) setSelectedId(null);
    await load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <input
            className="input"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <a
          className="btn btn-secondary btn-sm"
          href="/api/recipes/export"
          target="_blank"
          rel="noopener"
          title="Download all recipes as a PDF cookbook"
        >
          <Download size={14} /> Export PDF
        </a>
        {canEdit && (
          <button className="btn btn-primary btn-sm" onClick={openNew}>
            <Plus size={14} /> New Recipe
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted text-sm">Loading recipes…</p>
      ) : recipes.length === 0 ? (
        <div className="card p-8 text-center">
          <ChefHat className="mx-auto mb-2 text-violet-500" size={36} />
          <p className="font-semibold mb-1">No recipes yet</p>
          <p className="text-sm muted">
            {canEdit
              ? "Add your first recipe to start planning meals."
              : "Check back later — parents can add recipes."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ul className="space-y-2 lg:col-span-1">
            {recipes.map((r) => {
              const active = selectedId === r.id;
              return (
                <li key={r.id}>
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={`card w-full text-left p-3 ${
                      active ? "ring-2 ring-violet-500" : ""
                    }`}
                  >
                    <div className="font-semibold truncate">{r.title}</div>
                    {r.description && (
                      <div className="text-sm muted line-clamp-1">
                        {r.description}
                      </div>
                    )}
                    <div className="text-xs muted mt-1 flex flex-wrap items-center gap-2">
                      {r.servings && (
                        <span className="chip">
                          <Users size={11} /> {r.servings}
                        </span>
                      )}
                      {(r.prepMinutes || r.cookMinutes) && (
                        <span className="chip">
                          <Clock size={11} />
                          {(r.prepMinutes ?? 0) + (r.cookMinutes ?? 0)}m
                        </span>
                      )}
                      {(r.caloriesTotal != null || r.caloriesPerServing != null) && (
                        <span className="chip">
                          <Flame size={11} />
                          {r.caloriesPerServing != null
                            ? `${r.caloriesPerServing}/serve`
                            : `${r.caloriesTotal} kcal`}
                        </span>
                      )}
                      {r.tags && (
                        <span className="truncate">{r.tags}</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div ref={detailRef} className="lg:col-span-2 scroll-mt-4">
            {selected ? (
              <RecipeDetail
                recipe={selected}
                canEdit={canEdit}
                canEditShopping={canEditShopping}
                onEdit={() => openEdit(selected)}
                onDelete={() => remove(selected)}
              />
            ) : (
              <div className="card p-8 text-center">
                <ChefHat className="mx-auto mb-2 muted" size={36} />
                <p className="muted text-sm">
                  Pick a recipe from the list to see its details.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <RecipeDialog
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function RecipeDetail({
  recipe,
  canEdit,
  canEditShopping,
  onEdit,
  onDelete,
}: {
  recipe: Recipe;
  canEdit: boolean;
  canEditShopping: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const imgSrc = recipeImageUrl(recipe);
  // v4.7.6 — Cook Mode toggle. The hook owns one share of the cook-mode
  // counter for the lifetime of this component, so navigating away
  // automatically releases the wake-lock and lets the kiosk's screensaver
  // / night-cover resume.
  const cook = useCookMode();

  // v4.7.19 — recipe ingredients → shopping list. Per-row "+" buttons and a
  // header "Add all to shopping list" button both hit /api/shopping/from-
  // recipe, which dedupes against the open list and learns into the catalog.
  const [busyAddAll, setBusyAddAll] = useState(false);
  const [busyIngId, setBusyIngId] = useState<string | null>(null);

  async function addIngredients(ingredientIds?: string[]) {
    const res = await fetch("/api/shopping/from-recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeId: recipe.id, ingredientIds }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(d.error || "Could not add to shopping list");
      return;
    }
    const addedNoun = d.added === 1 ? "item" : "items";
    if (d.added === 0 && d.skipped > 0) {
      alert(`Already on the shopping list (skipped ${d.skipped}).`);
    } else if (d.skipped > 0) {
      alert(`Added ${d.added} ${addedNoun}. ${d.skipped} already on the list.`);
    } else if (d.added > 0) {
      alert(`Added ${d.added} ${addedNoun} to the shopping list.`);
    }
  }

  async function addAll() {
    setBusyAddAll(true);
    try {
      await addIngredients();
    } finally {
      setBusyAddAll(false);
    }
  }

  async function addOne(ingredientId: string) {
    setBusyIngId(ingredientId);
    try {
      await addIngredients([ingredientId]);
    } finally {
      setBusyIngId(null);
    }
  }

  return (
    <article className="card p-5 space-y-4">
      <header>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold">{recipe.title}</h2>
            {recipe.description && (
              <p className="text-sm muted mt-1">{recipe.description}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={cook.toggle}
              className={
                "btn btn-sm inline-flex items-center " +
                (cook.active
                  ? "bg-amber-500 text-white border-transparent hover:brightness-105"
                  : "btn-secondary")
              }
              title={
                cook.supported
                  ? cook.active
                    ? "Cook Mode is on — screen will stay awake"
                    : "Keep this screen awake while you cook"
                  : "Cook Mode (this browser can't keep the screen awake; the screensaver / night cover are still suppressed)"
              }
              aria-pressed={cook.active}
            >
              <Lightbulb size={14} />
              {cook.active ? "Cook Mode on" : "Cook Mode"}
            </button>
            {canEditShopping && recipe.ingredients.length > 0 && (
              <button
                type="button"
                onClick={addAll}
                disabled={busyAddAll}
                className="btn btn-primary btn-sm inline-flex items-center"
                title="Add every ingredient to the shopping list (duplicates skipped)"
              >
                <ShoppingCart size={14} />
                {busyAddAll ? "Adding…" : "Add all to shopping list"}
              </button>
            )}
            {canEdit && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={onEdit}>
                  Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={onDelete}
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2 text-xs muted">
          {recipe.servings && (
            <span className="chip">
              <Users size={12} /> {recipe.servings} serves
            </span>
          )}
          {recipe.prepMinutes != null && (
            <span className="chip">
              <Clock size={12} /> prep {recipe.prepMinutes}m
            </span>
          )}
          {recipe.cookMinutes != null && (
            <span className="chip">
              <Clock size={12} /> cook {recipe.cookMinutes}m
            </span>
          )}
          {recipe.caloriesTotal != null && (
            <span className="chip">
              <Flame size={12} /> {recipe.caloriesTotal} kcal total
            </span>
          )}
          {recipe.caloriesPerServing != null && (
            <span className="chip">
              <Flame size={12} /> {recipe.caloriesPerServing} kcal / serve
            </span>
          )}
          {recipe.tags &&
            recipe.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
        </div>
      </header>

      {imgSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={recipe.title}
          className="w-full max-h-80 object-cover rounded-xl"
        />
      )}

      {recipe.ingredients.length > 0 && (
        <section>
          <h3 className="font-bold mb-2">Ingredients</h3>
          <ul className="space-y-1 text-sm">
            {recipe.ingredients.map((i, idx) => (
              <li key={i.id ?? idx} className="flex items-center gap-2">
                <span className="w-28 muted shrink-0">
                  {[i.quantity, i.unit].filter(Boolean).join(" ") || "—"}
                </span>
                <span className="flex-1">{i.name}</span>
                {i.category && (
                  <span className="text-xs muted">{i.category}</span>
                )}
                {canEditShopping && i.id && (
                  <button
                    type="button"
                    onClick={() => i.id && addOne(i.id)}
                    disabled={busyIngId === i.id}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Add ${i.name} to shopping list`}
                    title="Add to shopping list"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {recipe.instructions.trim() && (
        <section>
          <h3 className="font-bold mb-2">Instructions</h3>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {recipe.instructions}
          </div>
        </section>
      )}
    </article>
  );
}

function RecipeDialog({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: EditForm;
  onChange: (v: EditForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateIngredient(idx: number, patch: Partial<Ingredient>) {
    const next = value.ingredients.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...value, ingredients: next });
  }

  function addIngredient() {
    onChange({
      ...value,
      ingredients: [
        ...value.ingredients,
        { name: "", quantity: "", unit: "", category: "" },
      ],
    });
  }

  function removeIngredient(idx: number) {
    const next = value.ingredients.slice();
    next.splice(idx, 1);
    onChange({
      ...value,
      ingredients:
        next.length > 0
          ? next
          : [{ name: "", quantity: "", unit: "", category: "" }],
    });
  }

  function handleFile(file: File | null) {
    if (!file) {
      onChange({ ...value, imageFile: null, imagePreview: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange({
        ...value,
        imageFile: file,
        imagePreview: typeof reader.result === "string" ? reader.result : null,
      });
    };
    reader.readAsDataURL(file);
  }

  async function removeExistingImage() {
    if (!value.id) {
      // New recipe that hasn't been saved yet — just drop the picked file.
      onChange({ ...value, imageFile: null, imagePreview: null });
      return;
    }
    if (!confirm("Remove the uploaded recipe photo?")) return;
    const res = await fetch(`/api/recipes/${value.id}/image`, {
      method: "DELETE",
    });
    if (res.ok) {
      onChange({ ...value, imageFilename: null, imageFile: null, imagePreview: null });
    } else {
      alert("Could not remove image");
    }
  }

  // Picked file preview wins over the stored filename so users see what they
  // just chose, before save().
  const previewSrc =
    value.imagePreview ??
    (value.id && value.imageFilename
      ? `/api/recipes/${value.id}/image?v=${encodeURIComponent(value.imageFilename)}`
      : null);

  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-2xl p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold mb-4 pr-10">
          {value.id ? "Edit Recipe" : "New Recipe"}
        </h3>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-sm font-medium">Title</label>
            <input
              className="input mt-1"
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium">Description</label>
            <textarea
              rows={2}
              className="textarea mt-1"
              value={value.description}
              onChange={(e) =>
                onChange({ ...value, description: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">Servings</label>
            <input
              type="number"
              min={1}
              className="input mt-1"
              value={value.servings}
              onChange={(e) => onChange({ ...value, servings: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Tags (comma separated)</label>
            <input
              className="input mt-1"
              value={value.tags}
              placeholder="quick, vegetarian"
              onChange={(e) => onChange({ ...value, tags: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Prep (minutes)</label>
            <input
              type="number"
              min={0}
              className="input mt-1"
              value={value.prepMinutes}
              onChange={(e) =>
                onChange({ ...value, prepMinutes: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">Cook (minutes)</label>
            <input
              type="number"
              min={0}
              className="input mt-1"
              value={value.cookMinutes}
              onChange={(e) =>
                onChange({ ...value, cookMinutes: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">Calories — total</label>
            <input
              type="number"
              min={0}
              className="input mt-1"
              value={value.caloriesTotal}
              placeholder="e.g. 2400"
              onChange={(e) =>
                onChange({ ...value, caloriesTotal: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              Calories — per serving
            </label>
            <input
              type="number"
              min={0}
              className="input mt-1"
              value={value.caloriesPerServing}
              placeholder="auto from total ÷ servings"
              onChange={(e) =>
                onChange({ ...value, caloriesPerServing: e.target.value })
              }
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium">Photo (optional)</label>
            <div className="mt-1 flex items-start gap-3 flex-wrap">
              {previewSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewSrc}
                  alt="Recipe preview"
                  className="w-32 h-32 object-cover rounded-lg border"
                />
              ) : (
                <div className="w-32 h-32 rounded-lg border-2 border-dashed flex items-center justify-center muted">
                  <ImageIcon size={32} />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) =>
                    handleFile(e.target.files?.[0] ?? null)
                  }
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  {value.imageFilename || value.imageFile
                    ? "Replace photo"
                    : "Upload photo"}
                </button>
                {(value.imageFilename || value.imageFile) && (
                  <button
                    type="button"
                    className="btn btn-ghost text-sm"
                    onClick={removeExistingImage}
                  >
                    <Trash2 size={14} /> Remove photo
                  </button>
                )}
                <p className="text-xs muted">JPEG, PNG, WebP or GIF. Max 10 MB.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold">Ingredients</h4>
            <button className="btn btn-ghost text-sm" onClick={addIngredient}>
              <Plus size={14} /> Add row
            </button>
          </div>
          <div className="space-y-2">
            {value.ingredients.map((ing, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 items-center"
              >
                <input
                  className="input col-span-2"
                  placeholder="qty"
                  value={ing.quantity ?? ""}
                  onChange={(e) =>
                    updateIngredient(idx, { quantity: e.target.value })
                  }
                />
                <input
                  className="input col-span-2"
                  placeholder="unit"
                  value={ing.unit ?? ""}
                  onChange={(e) =>
                    updateIngredient(idx, { unit: e.target.value })
                  }
                />
                <input
                  className="input col-span-5"
                  placeholder="Ingredient"
                  value={ing.name}
                  onChange={(e) =>
                    updateIngredient(idx, { name: e.target.value })
                  }
                />
                <input
                  className="input col-span-2"
                  placeholder="aisle"
                  value={ing.category ?? ""}
                  onChange={(e) =>
                    updateIngredient(idx, { category: e.target.value })
                  }
                />
                <button
                  className="btn btn-ghost col-span-1"
                  onClick={() => removeIngredient(idx)}
                  aria-label="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium">Instructions</label>
          <textarea
            rows={6}
            className="textarea mt-1 font-mono text-sm"
            value={value.instructions}
            placeholder="Step-by-step…"
            onChange={(e) =>
              onChange({ ...value, instructions: e.target.value })
            }
          />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={!value.title.trim()}
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
