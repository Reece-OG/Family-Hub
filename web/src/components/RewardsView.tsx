"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  Check,
  ImageIcon,
  Inbox,
  ListChecks,
  PackageCheck,
  Pencil,
  Plus,
  ShoppingBasket,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

// --------------------- Shared types ---------------------

type Me = { id: string; role: "PARENT" | "CHILD"; canManage: boolean };

type ChildBalance = {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  balance: number;
};

type LedgerEntry = {
  id: string;
  childId: string;
  points: number;
  reason: string;
  createdAt: string;
  awardedBy: {
    id: string;
    name: string;
    color: string;
    avatarEmoji: string;
  };
};

type RewardCategory = {
  id: string;
  name: string;
  hint: string | null;
  position: number;
  hidden: boolean;
  isStarter: boolean;
};

type RewardItem = {
  id: string;
  name: string;
  description: string | null;
  costPoints: number;
  available: boolean;
  position: number;
  imageFilename: string | null;
  imageMimeType: string | null;
  categoryId: string | null;
  category: RewardCategory | null;
};

type Redemption = {
  id: string;
  childId: string;
  child: { id: string; name: string; color: string; avatarEmoji: string };
  rewardItemId: string | null;
  rewardItem: { id: string; name: string; imageFilename: string | null; costPoints: number } | null;
  itemName: string;
  costPoints: number;
  status: "PENDING" | "FULFILLED" | "CANCELLED";
  createdAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  actor: { id: string; name: string; avatarEmoji: string } | null;
};

type Tab = "ledger" | "catalog" | "pending";

// --------------------- Top-level ---------------------

export function RewardsView({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>("ledger");
  const isParent = me.role === "PARENT";

  return (
    <div>
      <div className="inline-flex rounded-xl border border-[rgb(var(--border))] overflow-hidden mb-4 flex-wrap">
        <TabButton active={tab === "ledger"} onClick={() => setTab("ledger")}>
          <ListChecks size={14} /> Ledger
        </TabButton>
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
          <ShoppingBasket size={14} /> Catalogue
        </TabButton>
        {isParent && (
          <TabButton
            active={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            <Inbox size={14} /> Ready to fulfil
          </TabButton>
        )}
      </div>

      {tab === "ledger" && <LedgerTab me={me} />}
      {tab === "catalog" && <CatalogTab me={me} />}
      {tab === "pending" && isParent && <PendingTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 border-l first:border-l-0 border-[rgb(var(--border))] ${
        active ? "bg-violet-500 text-white" : ""
      }`}
    >
      {children}
    </button>
  );
}

// --------------------- Ledger tab ---------------------

function LedgerTab({ me }: { me: Me }) {
  const [balances, setBalances] = useState<ChildBalance[]>([]);
  const [focusChild, setFocusChild] = useState<string | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [awardOpen, setAwardOpen] = useState(false);

  const loadBalances = useCallback(async () => {
    const r = await fetch("/api/points").then((r) => r.json());
    setBalances(r.balances || []);
    if (me.role !== "PARENT" && r.balances?.length) {
      setFocusChild(r.balances[0].childId || r.balances[0].id);
    }
  }, [me.role]);

  const loadEntries = useCallback(async (childId: string | null) => {
    if (!childId) {
      setEntries([]);
      return;
    }
    const r = await fetch(
      `/api/points?childId=${encodeURIComponent(childId)}`,
    ).then((r) => r.json());
    setEntries(r.entries || []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadBalances();
      setLoading(false);
    })();
  }, [loadBalances]);

  useEffect(() => {
    if (focusChild) loadEntries(focusChild);
  }, [focusChild, loadEntries]);

  const focusBalance = useMemo(() => {
    if (!focusChild) return null;
    return balances.find((b) => b.id === focusChild) ?? null;
  }, [focusChild, balances]);

  async function refresh() {
    await loadBalances();
    if (focusChild) await loadEntries(focusChild);
  }

  async function removeEntry(id: string) {
    if (!confirm("Remove this ledger entry? Balance will recalculate.")) return;
    await fetch(`/api/points/${id}`, { method: "DELETE" });
    await refresh();
  }

  if (loading) return <p className="muted text-sm">Loading ledger…</p>;

  if (me.role !== "PARENT") {
    const myBalance = balances[0]?.balance ?? 0;
    return (
      <div>
        <div className="card p-8 text-center mb-4">
          <Sparkles className="mx-auto mb-2 text-amber-500" size={36} />
          <div className="text-sm muted">Your balance</div>
          <div className="text-5xl font-extrabold mt-1">{myBalance}</div>
          <div className="text-sm muted mt-1">points</div>
        </div>
        <h2 className="font-bold mb-2">Recent activity</h2>
        {entries.length === 0 ? (
          <p className="muted text-sm">No entries yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <LedgerRow key={e.id} e={e} canDelete={false} onDelete={() => {}} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setAwardOpen(true)}
          disabled={balances.length === 0}
        >
          <Plus size={14} /> Award / deduct points
        </button>
      </div>

      {balances.length === 0 ? (
        <div className="card p-6 text-center">
          <Sparkles className="mx-auto mb-2 text-amber-500" size={36} />
          <p className="font-semibold mb-1">No children yet</p>
          <p className="text-sm muted">
            Add at least one child on the Family page to start awarding points.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-6">
          {balances.map((b) => {
            const active = focusChild === b.id;
            return (
              <button
                key={b.id}
                onClick={() => setFocusChild(b.id)}
                className={`card p-4 text-left ${active ? "ring-2 ring-violet-500" : ""}`}
                style={{ borderColor: active ? b.color : undefined }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                    style={{
                      background: b.color + "33",
                      border: `1px solid ${b.color}`,
                    }}
                  >
                    {b.avatarEmoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{b.name}</div>
                    <div className="text-xs muted">Balance</div>
                    <div className="text-2xl font-extrabold">{b.balance}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {focusBalance && (
        <>
          <h2 className="font-bold mb-2">{focusBalance.name}’s ledger</h2>
          {entries.length === 0 ? (
            <p className="muted text-sm">No entries yet.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <LedgerRow
                  key={e.id}
                  e={e}
                  canDelete={me.canManage}
                  onDelete={() => removeEntry(e.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {awardOpen && (
        <AwardDialog
          children={balances}
          initialChildId={focusChild ?? balances[0]?.id ?? null}
          onClose={() => setAwardOpen(false)}
          onSaved={async () => {
            setAwardOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function LedgerRow({
  e,
  canDelete,
  onDelete,
}: {
  e: LedgerEntry;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const positive = e.points > 0;
  return (
    <li className="card p-3 flex items-center gap-3">
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center font-extrabold text-lg ${
          positive
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        }`}
      >
        {positive ? "+" : ""}
        {e.points}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{e.reason}</div>
        <div className="text-xs muted">
          {format(new Date(e.createdAt), "EEE d MMM, HH:mm")}
          {" · by "}
          {e.awardedBy.name}
        </div>
      </div>
      {canDelete && (
        <button className="btn btn-ghost" onClick={onDelete} aria-label="Delete">
          <Trash2 size={16} />
        </button>
      )}
    </li>
  );
}

// --------------------- Catalog tab ---------------------

function CatalogTab({ me }: { me: Me }) {
  const isParent = me.role === "PARENT";
  const [items, setItems] = useState<RewardItem[]>([]);
  const [categories, setCategories] = useState<RewardCategory[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RewardItem | "new" | null>(null);
  const [manageCats, setManageCats] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const [a, c, p] = await Promise.all([
        fetch("/api/rewards/catalog").then((r) => r.json()),
        fetch("/api/rewards/categories").then((r) => r.json()),
        me.role === "CHILD"
          ? fetch("/api/points").then((r) => r.json())
          : Promise.resolve({ balances: [] }),
      ]);
      setItems(a.items || []);
      setCategories(c.categories || []);
      if (me.role === "CHILD") {
        setBalance(p.balances?.[0]?.balance ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [me.role]);

  // v4.7.17 — refresh on mount + tab focus + 60-s tick.
  useAutoRefresh(load, { intervalMs: 60_000 });

  const visibleCategories = useMemo(
    () => categories.filter((c) => !c.hidden),
    [categories],
  );

  // Group items by category for the kid view. Parents see a flat list with
  // hidden / unavailable badges so they can manage in one pass.
  const grouped = useMemo(() => {
    const groups = new Map<string | null, RewardItem[]>();
    for (const it of items) {
      const key = it.category?.id ?? null;
      const arr = groups.get(key) ?? [];
      arr.push(it);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return groups;
  }, [items]);

  async function redeem(item: RewardItem) {
    if (item.costPoints > balance) {
      setBanner(`You need ${item.costPoints - balance} more points for ${item.name}.`);
      window.setTimeout(() => setBanner(null), 4000);
      return;
    }
    if (!confirm(`Redeem ${item.name} for ${item.costPoints} points?`)) return;
    setRedeeming(item.id);
    try {
      const res = await fetch("/api/rewards/redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardItemId: item.id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setBanner(d.error || "Could not redeem");
        window.setTimeout(() => setBanner(null), 4000);
        return;
      }
      setBanner(
        `Redeemed ${item.name}! A grown-up will mark it ready to collect.`,
      );
      window.setTimeout(() => setBanner(null), 5000);
      await load();
    } finally {
      setRedeeming(null);
    }
  }

  async function deleteItem(item: RewardItem) {
    if (!confirm(`Delete ${item.name}? Past redemptions will keep their history.`))
      return;
    await fetch(`/api/rewards/catalog/${item.id}`, { method: "DELETE" });
    await load();
  }

  if (loading) return <p className="muted text-sm">Loading catalogue…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {me.role === "CHILD" && (
          <div className="card p-2 px-3 flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" />
            <span className="text-xs muted">Balance</span>
            <span className="font-extrabold">{balance}</span>
          </div>
        )}
        <div className="flex-1" />
        {isParent && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setManageCats(true)}
            >
              <Tag size={14} /> Categories
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setEditing("new")}
            >
              <Plus size={14} /> New reward
            </button>
          </>
        )}
      </div>

      {banner && (
        <div className="text-sm rounded-xl px-3 py-2 mb-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          {banner}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <ShoppingBasket
            className="mx-auto mb-2 text-violet-500"
            size={36}
          />
          <p className="font-semibold mb-1">No rewards yet</p>
          <p className="text-sm muted">
            {isParent
              ? "Tap New reward to add the first item kids can spend their points on."
              : "Ask a grown-up to add some rewards in the catalogue."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleCategories.map((cat) => {
            const list = grouped.get(cat.id) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={cat.id}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h3 className="font-bold">{cat.name}</h3>
                  {cat.hint && (
                    <span className="text-xs muted">{cat.hint}</span>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((it) => (
                    <RewardCard
                      key={it.id}
                      item={it}
                      isParent={isParent}
                      childBalance={me.role === "CHILD" ? balance : null}
                      busy={redeeming === it.id}
                      onRedeem={() => redeem(it)}
                      onEdit={() => setEditing(it)}
                      onDelete={() => deleteItem(it)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {/* Items with no category (or category was deleted): drop into Other */}
          {(grouped.get(null)?.length ?? 0) > 0 && (
            <section>
              <div className="flex items-baseline gap-2 mb-2">
                <h3 className="font-bold">Uncategorised</h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(grouped.get(null) ?? []).map((it) => (
                  <RewardCard
                    key={it.id}
                    item={it}
                    isParent={isParent}
                    childBalance={me.role === "CHILD" ? balance : null}
                    busy={redeeming === it.id}
                    onRedeem={() => redeem(it)}
                    onEdit={() => setEditing(it)}
                    onDelete={() => deleteItem(it)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {editing && (
        <RewardEditor
          mode={editing === "new" ? "new" : "edit"}
          initial={editing === "new" ? null : editing}
          categories={visibleCategories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {manageCats && (
        <CategoriesDialog
          categories={categories}
          onClose={() => setManageCats(false)}
          onChanged={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}

function RewardCard({
  item,
  isParent,
  childBalance,
  busy,
  onRedeem,
  onEdit,
  onDelete,
}: {
  item: RewardItem;
  isParent: boolean;
  childBalance: number | null;
  busy: boolean;
  onRedeem: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canAfford =
    childBalance == null ? true : childBalance >= item.costPoints;
  return (
    <div className="card p-3 flex flex-col">
      {item.imageFilename ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/rewards/catalog/${item.id}/image`}
          alt={item.name}
          className="w-full h-32 object-cover rounded-lg mb-2"
        />
      ) : (
        <div className="w-full h-32 rounded-lg mb-2 bg-[rgb(var(--surface-2))] flex items-center justify-center text-violet-400">
          <ImageIcon size={32} />
        </div>
      )}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="font-semibold flex-1 min-w-0 truncate">
          {item.name}
        </span>
        <span className="chip text-amber-700 dark:text-amber-200">
          <Sparkles size={12} />
          {item.costPoints}
        </span>
      </div>
      {item.description && (
        <p className="text-xs muted mb-2 line-clamp-2">{item.description}</p>
      )}
      {isParent && !item.available && (
        <span className="chip text-rose-700 dark:text-rose-200 self-start mb-2">
          Hidden from kids
        </span>
      )}
      <div className="mt-auto flex gap-2 flex-wrap">
        {isParent ? (
          <>
            <button
              className="btn btn-secondary btn-sm flex-1"
              onClick={onEdit}
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={onDelete}
              aria-label="Delete reward"
            >
              <Trash2 size={14} />
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-sm flex-1"
            disabled={busy || !canAfford}
            onClick={onRedeem}
            title={
              canAfford
                ? `Redeem for ${item.costPoints} points`
                : "Not enough points yet"
            }
          >
            <Sparkles size={14} />
            {canAfford
              ? busy
                ? "Redeeming…"
                : "Redeem"
              : `Need ${item.costPoints - (childBalance ?? 0)} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// --------------------- Pending tab (parent only) ---------------------

function PendingTab() {
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const r = await fetch("/api/rewards/redemptions?status=pending").then(
        (r) => r.json(),
      );
      setRedemptions(r.redemptions || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // v4.7.17 — refresh on mount + tab focus + 60-s tick.
  useAutoRefresh(load, { intervalMs: 60_000 });

  async function fulfill(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/rewards/redemptions/${id}/fulfill`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Could not fulfil");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string, name: string) {
    if (
      !confirm(
        `Cancel "${name}"? Points will be refunded to the child's balance.`,
      )
    )
      return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/rewards/redemptions/${id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Could not cancel");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="muted text-sm">Loading queue…</p>;

  if (redemptions.length === 0) {
    return (
      <div className="card p-8 text-center">
        <PackageCheck className="mx-auto mb-2 text-emerald-500" size={36} />
        <p className="font-semibold mb-1">All caught up</p>
        <p className="text-sm muted">
          No redemptions waiting to be fulfilled. Once a child redeems a
          reward, it'll appear here for you to deliver and tick off.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {redemptions.map((r) => (
        <li key={r.id} className="card p-3 flex items-center gap-3 flex-wrap">
          {r.rewardItem?.imageFilename ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/rewards/catalog/${r.rewardItem.id}/image`}
              alt={r.itemName}
              className="w-14 h-14 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-lg bg-[rgb(var(--surface-2))] flex items-center justify-center text-violet-400 shrink-0">
              <ShoppingBasket size={24} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{r.itemName}</div>
            <div className="text-xs muted">
              <span
                className="chip mr-1"
                style={{
                  background: r.child.color + "33",
                  borderColor: r.child.color,
                }}
              >
                {r.child.avatarEmoji} {r.child.name}
              </span>
              {r.costPoints} pts · {format(new Date(r.createdAt), "EEE d MMM, HH:mm")}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => cancel(r.id, r.itemName)}
              disabled={busyId === r.id}
              title="Cancel and refund the points"
            >
              <Undo2 size={14} /> Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => fulfill(r.id)}
              disabled={busyId === r.id}
              title="Mark as delivered"
            >
              <Check size={14} /> Fulfil
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --------------------- Editor dialogs ---------------------

function RewardEditor({
  mode,
  initial,
  categories,
  onClose,
  onSaved,
}: {
  mode: "new" | "edit";
  initial: RewardItem | null;
  categories: RewardCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cost, setCost] = useState<number>(initial?.costPoints ?? 10);
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? "",
  );
  const [available, setAvailable] = useState<boolean>(initial?.available ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(Boolean(initial?.imageFilename));
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  async function uploadImage(itemId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/rewards/catalog/${itemId}/image`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || "Image upload failed");
    }
  }

  async function save() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (cost < 1) {
      setError("Cost must be at least 1 point");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        costPoints: cost,
        categoryId: categoryId || null,
        available,
      };
      const url =
        mode === "new"
          ? "/api/rewards/catalog"
          : `/api/rewards/catalog/${initial!.id}`;
      const method = mode === "new" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save reward");
      }
      const data = await res.json();
      const id: string = data.item.id;
      if (pendingFile) {
        await uploadImage(id, pendingFile);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeImage() {
    if (!initial) return;
    if (!confirm("Remove the image?")) return;
    const res = await fetch(`/api/rewards/catalog/${initial.id}/image`, {
      method: "DELETE",
    });
    if (res.ok) setHasImage(false);
  }

  return (
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
          <h3 className="text-lg font-bold mb-4 pr-10">
            {mode === "new" ? "New reward" : "Edit reward"}
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Name</label>
              <input
                className="input mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="$1 cash"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Cost (points)</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input mt-1"
                  value={cost}
                  onChange={(e) =>
                    setCost(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <select
                  className="input mt-1"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">— Uncategorised —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Description (optional)</label>
              <textarea
                rows={2}
                className="textarea mt-1"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Anytime — claim from the jar in the kitchen"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Image (optional)</label>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  <Upload size={14} />
                  {pendingFile
                    ? `Selected: ${pendingFile.name}`
                    : hasImage
                    ? "Replace"
                    : "Choose file"}
                  <input
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) =>
                      setPendingFile(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {hasImage && initial && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-rose-600 dark:text-rose-300"
                    onClick={removeImage}
                  >
                    Remove image
                  </button>
                )}
                <span className="text-xs muted">
                  JPEG / PNG / WebP / GIF · up to 6 MB
                </span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={available}
                onChange={(e) => setAvailable(e.target.checked)}
              />
              Available to redeem
              <span className="muted text-xs">
                (untick to stage a reward without showing it to kids yet)
              </span>
            </label>

            {error && (
              <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !name.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CategoriesDialog({
  categories,
  onClose,
  onChanged,
}: {
  categories: RewardCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [list, setList] = useState<RewardCategory[]>(categories);
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
      const res = await fetch("/api/rewards/categories", {
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

  async function patch(c: RewardCategory, patch: Partial<RewardCategory>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rewards/categories/${c.id}`, {
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

  async function destroy(c: RewardCategory) {
    if (
      !confirm(
        `Delete "${c.name}"? Existing rewards will become Uncategorised.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/rewards/categories/${c.id}`, {
        method: "DELETE",
      });
      if (res.ok) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
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
          <h3 className="text-lg font-bold mb-1 pr-10">Reward categories</h3>
          <p className="text-xs muted mb-4">
            Bundled starters — Cash, Sweets, Screen time, Privileges, Other —
            are just suggestions. Rename, hide, or delete any of them.
          </p>

          <ul className="space-y-2 mb-4">
            {list.map((c) => (
              <li key={c.id} className="card p-3">
                <div className="flex items-start gap-2">
                  <Tag
                    size={14}
                    className="mt-1 text-violet-500 shrink-0"
                  />
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
                        if (
                          v &&
                          v !== categories.find((x) => x.id === c.id)?.name
                        ) {
                          patch(c, { name: v } as Partial<RewardCategory>);
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
                        } as Partial<RewardCategory>)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <label className="text-xs flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={c.hidden}
                        onChange={(e) =>
                          patch(c, { hidden: e.target.checked })
                        }
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
                placeholder="Name (e.g. Toys)"
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

function AwardDialog({
  children: kids,
  initialChildId,
  onClose,
  onSaved,
}: {
  children: ChildBalance[];
  initialChildId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [childId, setChildId] = useState<string>(initialChildId ?? kids[0]?.id ?? "");
  const [points, setPoints] = useState<number>(5);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function save(sign: 1 | -1) {
    if (!childId || !reason.trim() || points === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          points: Math.abs(points) * sign,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Could not save");
        return;
      }
      await onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
          <h3 className="text-lg font-bold mb-4 pr-10">Award / Deduct Points</h3>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Child</label>
              <select
                className="input mt-1"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
              >
                {kids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.avatarEmoji} {k.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount</label>
              <input
                type="number"
                min={1}
                max={10000}
                className="input mt-1"
                value={points}
                onChange={(e) => setPoints(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <input
                className="input mt-1"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Great homework effort"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => save(-1)}
              disabled={submitting || !reason.trim()}
            >
              Deduct {points}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => save(1)}
              disabled={submitting || !reason.trim()}
            >
              Award {points}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
