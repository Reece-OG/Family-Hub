"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Download,
  FileText,
  FileUp,
  Paperclip,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";

// Keep these lists in sync with src/lib/maintenance.ts.
const DEVICE_TYPES = [
  { value: "CAR", label: "Car" },
  { value: "MOTORBIKE", label: "Motorbike" },
  { value: "BICYCLE", label: "Bicycle" },
  { value: "LAWNMOWER", label: "Lawnmower" },
  { value: "HEDGE_TRIMMER", label: "Hedge trimmer" },
  { value: "CHAINSAW", label: "Chainsaw" },
  { value: "PRESSURE_WASHER", label: "Pressure washer" },
  { value: "APPLIANCE", label: "Appliance" },
  { value: "TOOL", label: "Tool" },
  { value: "OTHER", label: "Other" },
] as const;

const INTERVAL_CHOICES = [
  { value: 3, label: "Every 3 months" },
  { value: 6, label: "Every 6 months" },
  { value: 12, label: "Every 12 months" },
  { value: 24, label: "Every 24 months" },
];

function deviceLabel(type: string): string {
  return DEVICE_TYPES.find((d) => d.value === type)?.label ?? type;
}

type UserMini = {
  id: string;
  name: string;
  avatarEmoji: string;
  color: string;
};

type ServiceRecord = {
  id: string;
  servicedAt: string;
  workDone: string;
  performedBy: string | null;
  cost: string | number | null;
  notes: string | null;
  loggedBy?: UserMini | null;
};

type MaintenanceItem = {
  id: string;
  name: string;
  deviceType: string;
  serviceIntervalMonths: number;
  identifier: string | null;
  notes: string | null;
  remindEnabled: boolean;
  lastServicedAt: string | null;
  nextServiceDue: string | null;
  owner?: UserMini | null;
  serviceRecords?: ServiceRecord[];
  _count?: { serviceRecords: number };
  // v4.4 additions
  registrationNumber: string | null;
  registrationExpiresAt: string | null;
  registrationDocFilename: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiresAt: string | null;
  insuranceDocFilename: string | null;
};

type ItemForm = {
  id?: string;
  name: string;
  deviceType: string;
  serviceIntervalMonths: number;
  identifier: string;
  notes: string;
  remindEnabled: boolean;
  lastServicedAt: string;
  registrationNumber: string;
  registrationExpiresAt: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceExpiresAt: string;
};

type RecordForm = {
  id?: string;
  servicedAt: string;
  performedBy: string;
  workDone: string;
  cost: string;
  notes: string;
};

type Me = {
  id: string;
  role: "PARENT" | "CHILD";
  canManage: boolean;
};

function todayLocalISO(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateInputFromISO(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateInputToISO(local: string): string | null {
  if (!local) return null;
  const d = new Date(local + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function MaintenanceView({ me }: { me: Me }) {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MaintenanceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemForm | null>(null);
  const [editingRecord, setEditingRecord] = useState<RecordForm | null>(null);
  const [filter, setFilter] = useState<"all" | "due" | "upcoming">("all");

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const res = await fetch("/api/maintenance");
      const data = await res.json();
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/maintenance/${id}`);
      if (!res.ok) {
        setDetail(null);
        return;
      }
      const data = await res.json();
      setDetail(data.item);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // v4.7.17 — refresh on mount + tab focus, slow 5-minute polling tick.
  useAutoRefresh(load, { intervalMs: 5 * 60_000 });

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return items.filter((item) => {
      if (filter === "all") return true;
      // Items without a scheduled next-service date only show in "all".
      if (!item.nextServiceDue) return false;
      const due = new Date(item.nextServiceDue);
      if (filter === "due") return due <= now;
      if (filter === "upcoming") return due > now && due <= in30;
      return true;
    });
  }, [items, filter]);

  const counts = useMemo(() => {
    const now = new Date();
    let due = 0;
    for (const item of items) {
      if (item.nextServiceDue && new Date(item.nextServiceDue) <= now) due += 1;
    }
    return { total: items.length, due };
  }, [items]);

  function openNewItem() {
    setEditingItem({
      name: "",
      deviceType: "CAR",
      serviceIntervalMonths: 12,
      identifier: "",
      notes: "",
      remindEnabled: true,
      lastServicedAt: "",
      registrationNumber: "",
      registrationExpiresAt: "",
      insuranceProvider: "",
      insurancePolicyNumber: "",
      insuranceExpiresAt: "",
    });
  }

  function openEditItem(item: MaintenanceItem) {
    setEditingItem({
      id: item.id,
      name: item.name,
      deviceType: item.deviceType,
      serviceIntervalMonths: item.serviceIntervalMonths,
      identifier: item.identifier ?? "",
      notes: item.notes ?? "",
      remindEnabled: item.remindEnabled,
      lastServicedAt: dateInputFromISO(item.lastServicedAt),
      registrationNumber: item.registrationNumber ?? "",
      registrationExpiresAt: dateInputFromISO(item.registrationExpiresAt),
      insuranceProvider: item.insuranceProvider ?? "",
      insurancePolicyNumber: item.insurancePolicyNumber ?? "",
      insuranceExpiresAt: dateInputFromISO(item.insuranceExpiresAt),
    });
  }

  async function saveItem() {
    if (!editingItem) return;
    const payload: Record<string, unknown> = {
      name: editingItem.name.trim(),
      deviceType: editingItem.deviceType,
      serviceIntervalMonths: editingItem.serviceIntervalMonths,
      identifier: editingItem.identifier.trim() || null,
      notes: editingItem.notes.trim() || null,
      remindEnabled: editingItem.remindEnabled,
      lastServicedAt: dateInputToISO(editingItem.lastServicedAt),
      registrationNumber: editingItem.registrationNumber.trim() || null,
      registrationExpiresAt: dateInputToISO(editingItem.registrationExpiresAt),
      insuranceProvider: editingItem.insuranceProvider.trim() || null,
      insurancePolicyNumber:
        editingItem.insurancePolicyNumber.trim() || null,
      insuranceExpiresAt: dateInputToISO(editingItem.insuranceExpiresAt),
    };
    const res = await fetch(
      editingItem.id ? `/api/maintenance/${editingItem.id}` : "/api/maintenance",
      {
        method: editingItem.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) {
      const data = await res.json();
      setEditingItem(null);
      await load();
      if (!editingItem.id && data.item?.id) {
        setSelectedId(data.item.id);
      } else if (editingItem.id) {
        await loadDetail(editingItem.id);
      }
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not save item");
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this device and its service history?")) return;
    const res = await fetch(`/api/maintenance/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedId(null);
      await load();
    }
  }

  function openNewRecord() {
    if (!detail) return;
    setEditingRecord({
      servicedAt: todayLocalISO(),
      performedBy: "",
      workDone: "",
      cost: "",
      notes: "",
    });
  }

  async function saveRecord() {
    if (!editingRecord || !detail) return;
    const servicedISO = dateInputToISO(editingRecord.servicedAt);
    if (!servicedISO) {
      alert("Pick a service date");
      return;
    }
    const costNum = editingRecord.cost.trim()
      ? Number(editingRecord.cost)
      : null;
    if (costNum !== null && (!Number.isFinite(costNum) || costNum < 0)) {
      alert("Cost must be a positive number");
      return;
    }
    const payload = {
      servicedAt: servicedISO,
      workDone: editingRecord.workDone.trim(),
      performedBy: editingRecord.performedBy.trim() || null,
      cost: costNum,
      notes: editingRecord.notes.trim() || null,
    };
    const res = await fetch(
      `/api/maintenance/${detail.id}/service-records`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) {
      setEditingRecord(null);
      await Promise.all([load(), loadDetail(detail.id)]);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not save record");
    }
  }

  async function uploadDoc(
    itemId: string,
    kind: "registration" | "insurance",
    file: File,
  ) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(
      `/api/maintenance/${itemId}/doc?kind=${kind}`,
      { method: "POST", body: fd },
    );
    if (res.ok) {
      await Promise.all([load(), loadDetail(itemId)]);
    } else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not upload document");
    }
  }

  async function deleteDoc(
    itemId: string,
    kind: "registration" | "insurance",
  ) {
    if (!confirm(`Remove the ${kind} document?`)) return;
    const res = await fetch(
      `/api/maintenance/${itemId}/doc?kind=${kind}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      await Promise.all([load(), loadDetail(itemId)]);
    }
  }

  async function deleteRecord(recordId: string) {
    if (!detail) return;
    if (!confirm("Delete this service record?")) return;
    const res = await fetch(
      `/api/maintenance/${detail.id}/service-records/${recordId}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      await Promise.all([load(), loadDetail(detail.id)]);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Left column — list */}
      <div className="lg:col-span-1">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="inline-flex rounded-xl border border-[rgb(var(--border))] overflow-hidden">
            {[
              { k: "all", label: `All (${counts.total})` },
              { k: "due", label: `Due (${counts.due})` },
              { k: "upcoming", label: "Next 30d" },
            ].map((t, idx) => (
              <button
                key={t.k}
                onClick={() => setFilter(t.k as typeof filter)}
                className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm ${
                  idx > 0 ? "border-l border-[rgb(var(--border))]" : ""
                } ${
                  filter === t.k ? "bg-violet-500 text-white" : ""
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {me.canManage && (
            <button className="btn btn-primary btn-sm" onClick={openNewItem}>
              <Plus size={14} /> Device
            </button>
          )}
        </div>

        {loading ? (
          <p className="muted text-sm">Loading maintenance…</p>
        ) : filtered.length === 0 ? (
          <div className="card p-6 text-center">
            <Wrench className="mx-auto mb-2 text-violet-500" size={32} />
            <p className="font-semibold mb-1">Nothing here yet</p>
            <p className="text-sm muted">
              {me.canManage
                ? "Add a device to start tracking its service schedule."
                : "Ask a parent to add devices to the maintenance log."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                active={item.id === selectedId}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Right column — detail */}
      <div className="lg:col-span-2">
        {!selectedId ? (
          <div className="card p-8 text-center">
            <FileText className="mx-auto mb-2 text-violet-500" size={32} />
            <p className="font-semibold mb-1">Pick a device</p>
            <p className="text-sm muted">
              Select a device on the left to see its full history and export to
              PDF.
            </p>
          </div>
        ) : detailLoading || !detail ? (
          <p className="muted text-sm">Loading…</p>
        ) : (
          <DetailPanel
            item={detail}
            canManage={me.canManage}
            onEdit={() => openEditItem(detail)}
            onDelete={() => deleteItem(detail.id)}
            onAddRecord={openNewRecord}
            onDeleteRecord={deleteRecord}
            onUploadDoc={uploadDoc}
            onDeleteDoc={deleteDoc}
          />
        )}
      </div>

      {editingItem && (
        <ItemDialog
          value={editingItem}
          onChange={setEditingItem}
          onClose={() => setEditingItem(null)}
          onSave={saveItem}
        />
      )}

      {editingRecord && (
        <RecordDialog
          value={editingRecord}
          onChange={setEditingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={saveRecord}
        />
      )}
    </div>
  );
}

function ItemCard({
  item,
  active,
  onSelect,
}: {
  item: MaintenanceItem;
  active: boolean;
  onSelect: () => void;
}) {
  const due = item.nextServiceDue ? new Date(item.nextServiceDue) : null;
  const overdue = due ? isPast(due) : false;
  return (
    <li>
      <button
        onClick={onSelect}
        className={`card w-full text-left p-3 transition ${
          active ? "ring-2 ring-[rgb(var(--brand))]" : ""
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{item.name}</div>
            <div className="text-xs muted">
              {deviceLabel(item.deviceType)} · every{" "}
              {item.serviceIntervalMonths} mo
            </div>
            <div className="text-sm mt-1">
              {due ? (
                overdue ? (
                  <span className="chip text-rose-700 dark:text-rose-300">
                    <AlertTriangle size={12} /> Overdue{" "}
                    {formatDistanceToNow(due, { addSuffix: true })}
                  </span>
                ) : (
                  <span className="muted">
                    Due {format(due, "d MMM yyyy")}
                  </span>
                )
              ) : (
                <span className="muted">No schedule yet</span>
              )}
            </div>
          </div>
          {!item.remindEnabled && (
            <BellOff
              size={14}
              className="mt-1 text-zinc-400"
              aria-label="Reminders off"
            />
          )}
        </div>
      </button>
    </li>
  );
}

function DetailPanel({
  item,
  canManage,
  onEdit,
  onDelete,
  onAddRecord,
  onDeleteRecord,
  onUploadDoc,
  onDeleteDoc,
}: {
  item: MaintenanceItem;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddRecord: () => void;
  onDeleteRecord: (id: string) => void;
  onUploadDoc: (
    itemId: string,
    kind: "registration" | "insurance",
    file: File,
  ) => Promise<void> | void;
  onDeleteDoc: (
    itemId: string,
    kind: "registration" | "insurance",
  ) => Promise<void> | void;
}) {
  const records = item.serviceRecords ?? [];
  const due = item.nextServiceDue ? new Date(item.nextServiceDue) : null;
  const overdue = due ? isPast(due) : false;
  const pdfHref = `/api/maintenance/${item.id}/pdf`;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-xs muted uppercase tracking-wide">
              {deviceLabel(item.deviceType)}
            </div>
            <h2 className="text-xl font-bold">{item.name}</h2>
            {item.identifier && (
              <div className="text-sm muted mt-0.5">
                {item.identifier}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              className="btn btn-secondary"
              href={pdfHref}
              target="_blank"
              rel="noopener"
            >
              <Download size={16} /> PDF
            </a>
            {canManage && (
              <>
                <button className="btn btn-secondary" onClick={onEdit}>
                  Edit
                </button>
                <button className="btn btn-danger" onClick={onDelete}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
          <Stat label="Service interval">
            Every {item.serviceIntervalMonths} mo
          </Stat>
          <Stat label="Last serviced">
            {item.lastServicedAt
              ? format(new Date(item.lastServicedAt), "d MMM yyyy")
              : "—"}
          </Stat>
          <Stat label="Next due">
            {due ? (
              overdue ? (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  Overdue · {format(due, "d MMM yyyy")}
                </span>
              ) : (
                format(due, "d MMM yyyy")
              )
            ) : (
              "—"
            )}
          </Stat>
          <Stat label="Reminders">
            {item.remindEnabled ? (
              <span className="flex items-center gap-1">
                <Bell size={14} /> On
              </span>
            ) : (
              <span className="flex items-center gap-1 muted">
                <BellOff size={14} /> Off
              </span>
            )}
          </Stat>
        </div>

        {item.notes && (
          <div className="mt-4">
            <div className="text-xs muted uppercase tracking-wide mb-1">
              Notes
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.notes}</p>
          </div>
        )}
      </div>

      <DocCard
        kind="registration"
        title="Registration"
        icon={<FileText size={18} />}
        number={item.registrationNumber}
        numberLabel="Registration number"
        provider={null}
        expiresAt={item.registrationExpiresAt}
        docFilename={item.registrationDocFilename}
        itemId={item.id}
        canManage={canManage}
        onUpload={onUploadDoc}
        onDelete={onDeleteDoc}
      />

      <DocCard
        kind="insurance"
        title="Insurance"
        icon={<ShieldCheck size={18} />}
        number={item.insurancePolicyNumber}
        numberLabel="Policy number"
        provider={item.insuranceProvider}
        expiresAt={item.insuranceExpiresAt}
        docFilename={item.insuranceDocFilename}
        itemId={item.id}
        canManage={canManage}
        onUpload={onUploadDoc}
        onDelete={onDeleteDoc}
      />

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">Service History</h3>
          {canManage && (
            <button className="btn btn-primary" onClick={onAddRecord}>
              <Plus size={16} /> Log Service
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <p className="muted text-sm">
            No service records yet. Log one to update the schedule.
          </p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--border))]">
            {records.map((r) => (
              <li key={r.id} className="py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {format(new Date(r.servicedAt), "EEE d MMM yyyy")}
                    {r.performedBy && (
                      <span className="muted font-normal">
                        {" "}
                        · {r.performedBy}
                      </span>
                    )}
                  </div>
                  <div className="text-sm mt-1 whitespace-pre-wrap">
                    {r.workDone}
                  </div>
                  {r.notes && (
                    <div className="text-sm muted mt-1 whitespace-pre-wrap">
                      {r.notes}
                    </div>
                  )}
                  <div className="text-xs muted mt-1 flex flex-wrap gap-2 items-center">
                    {r.cost !== null && r.cost !== undefined && (
                      <span className="chip">Cost: {String(r.cost)}</span>
                    )}
                    {r.loggedBy && (
                      <span className="chip">
                        {r.loggedBy.avatarEmoji} logged by {r.loggedBy.name}
                      </span>
                    )}
                  </div>
                </div>
                {canManage && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => onDeleteRecord(r.id)}
                    aria-label="Delete record"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}

function expiryBadge(iso: string | null): React.ReactNode {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((d.getTime() - now.getTime()) / msPerDay);
  if (daysLeft < 0) {
    return (
      <span className="chip text-rose-700 dark:text-rose-300">
        <AlertTriangle size={12} /> Expired {format(d, "d MMM yyyy")}
      </span>
    );
  }
  if (daysLeft <= 30) {
    return (
      <span className="chip text-amber-700 dark:text-amber-300">
        <AlertTriangle size={12} /> Expires in {daysLeft}{" "}
        {daysLeft === 1 ? "day" : "days"}
      </span>
    );
  }
  return <span className="chip muted">Valid until {format(d, "d MMM yyyy")}</span>;
}

function DocCard({
  kind,
  title,
  icon,
  number,
  numberLabel,
  provider,
  expiresAt,
  docFilename,
  itemId,
  canManage,
  onUpload,
  onDelete,
}: {
  kind: "registration" | "insurance";
  title: string;
  icon: React.ReactNode;
  number: string | null;
  numberLabel: string;
  provider: string | null;
  expiresAt: string | null;
  docFilename: string | null;
  itemId: string;
  canManage: boolean;
  onUpload: (
    itemId: string,
    kind: "registration" | "insurance",
    file: File,
  ) => Promise<void> | void;
  onDelete: (
    itemId: string,
    kind: "registration" | "insurance",
  ) => Promise<void> | void;
}) {
  const docHref = `/api/maintenance/${itemId}/doc?kind=${kind}`;
  const hasAnyData =
    number || provider || expiresAt || docFilename;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {expiresAt && expiryBadge(expiresAt)}
      </div>

      {hasAnyData ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          {provider !== null && (
            <Stat label="Provider">{provider || "—"}</Stat>
          )}
          <Stat label={numberLabel}>{number || "—"}</Stat>
          <Stat label="Expires">
            {expiresAt ? format(new Date(expiresAt), "d MMM yyyy") : "—"}
          </Stat>
        </div>
      ) : (
        <p className="muted text-sm">
          {canManage
            ? `No ${title.toLowerCase()} details yet. Add them with Edit.`
            : `No ${title.toLowerCase()} details on file.`}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {docFilename ? (
          <>
            <a
              className="btn btn-secondary"
              href={docHref}
              target="_blank"
              rel="noopener"
            >
              <Paperclip size={16} /> View document
            </a>
            {canManage && (
              <>
                <label className="btn btn-secondary cursor-pointer">
                  <Upload size={16} /> Replace
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUpload(itemId, kind, f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>
                <button
                  className="btn btn-danger"
                  onClick={() => onDelete(itemId, kind)}
                  aria-label={`Remove ${title} document`}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </>
        ) : canManage ? (
          <label className="btn btn-secondary cursor-pointer">
            <FileUp size={16} /> Upload document
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(itemId, kind, f);
                e.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <span className="text-sm muted">No document uploaded.</span>
        )}
      </div>
    </div>
  );
}

function ItemDialog({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: ItemForm;
  onChange: (v: ItemForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
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
        <h3 className="text-lg font-bold mb-4 pr-10">
          {value.id ? "Edit Device" : "New Device"}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              className="input mt-1"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="Mum's Golf"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Type</label>
              <select
                className="input mt-1"
                value={value.deviceType}
                onChange={(e) =>
                  onChange({ ...value, deviceType: e.target.value })
                }
              >
                {DEVICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Service interval</label>
              <select
                className="input mt-1"
                value={value.serviceIntervalMonths}
                onChange={(e) =>
                  onChange({
                    ...value,
                    serviceIntervalMonths: Number(e.target.value),
                  })
                }
              >
                {INTERVAL_CHOICES.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">
              Identifier (optional)
            </label>
            <input
              className="input mt-1"
              value={value.identifier}
              onChange={(e) =>
                onChange({ ...value, identifier: e.target.value })
              }
              placeholder="AB12 CDE · VIN · serial no."
            />
          </div>

          <div>
            <label className="text-sm font-medium">
              Last serviced (optional)
            </label>
            <input
              type="date"
              className="input mt-1"
              value={value.lastServicedAt}
              onChange={(e) =>
                onChange({ ...value, lastServicedAt: e.target.value })
              }
            />
            <p className="text-xs muted mt-1">
              We'll set the next-due date automatically from this + the
              interval.
            </p>
          </div>

          <div className="border-t border-[rgb(var(--border))] pt-3">
            <div className="text-xs muted uppercase tracking-wide mb-2 flex items-center gap-1">
              <FileText size={12} /> Registration
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Number</label>
                <input
                  className="input mt-1"
                  value={value.registrationNumber}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      registrationNumber: e.target.value,
                    })
                  }
                  placeholder="AB12 CDE"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Expires</label>
                <input
                  type="date"
                  className="input mt-1"
                  value={value.registrationExpiresAt}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      registrationExpiresAt: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <p className="text-xs muted mt-1">
              Upload the certificate from the detail view once the device is
              saved.
            </p>
          </div>

          <div className="border-t border-[rgb(var(--border))] pt-3">
            <div className="text-xs muted uppercase tracking-wide mb-2 flex items-center gap-1">
              <ShieldCheck size={12} /> Insurance
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-sm font-medium">Provider</label>
                <input
                  className="input mt-1"
                  value={value.insuranceProvider}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      insuranceProvider: e.target.value,
                    })
                  }
                  placeholder="Aviva · Direct Line · …"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Policy number</label>
                <input
                  className="input mt-1"
                  value={value.insurancePolicyNumber}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      insurancePolicyNumber: e.target.value,
                    })
                  }
                  placeholder="POL-12345"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Expires</label>
                <input
                  type="date"
                  className="input mt-1"
                  value={value.insuranceExpiresAt}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      insuranceExpiresAt: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              rows={3}
              className="textarea mt-1"
              value={value.notes}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              placeholder="What's been done · what to do next · tyre sizes · oil grade"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.remindEnabled}
              onChange={(e) =>
                onChange({ ...value, remindEnabled: e.target.checked })
              }
            />
            Auto-reminder when service falls due
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={!value.name.trim()}
          >
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function RecordDialog({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: RecordForm;
  onChange: (v: RecordForm) => void;
  onClose: () => void;
  onSave: () => void;
}) {
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
        <h3 className="text-lg font-bold mb-4 pr-10">Log Service</h3>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                className="input mt-1"
                value={value.servicedAt}
                onChange={(e) =>
                  onChange({ ...value, servicedAt: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Cost (optional)</label>
              <input
                className="input mt-1"
                inputMode="decimal"
                value={value.cost}
                onChange={(e) => onChange({ ...value, cost: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Performed by</label>
            <input
              className="input mt-1"
              value={value.performedBy}
              onChange={(e) =>
                onChange({ ...value, performedBy: e.target.value })
              }
              placeholder="Garage · shop · me"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Work done</label>
            <textarea
              rows={3}
              className="textarea mt-1"
              value={value.workDone}
              onChange={(e) =>
                onChange({ ...value, workDone: e.target.value })
              }
              placeholder="Oil + filter · brake pads front"
            />
          </div>

          <div>
            <label className="text-sm font-medium">
              Follow-up notes (optional)
            </label>
            <textarea
              rows={2}
              className="textarea mt-1"
              value={value.notes}
              onChange={(e) => onChange({ ...value, notes: e.target.value })}
              placeholder="Rear pads next time · tyre tread low"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-5">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={!value.workDone.trim()}
          >
            Save record
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
