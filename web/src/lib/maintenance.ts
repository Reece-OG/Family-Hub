// Helpers shared by the maintenance API routes and the reminder scheduler.

import { addMonths } from "date-fns";
import { prisma } from "./prisma";

// Add `months` months to `from` (preserves day-of-month where possible).
export function computeNextDue(from: Date, months: number): Date {
  const m = Number.isFinite(months) && months > 0 ? months : 12;
  return addMonths(from, m);
}

// Recompute nextServiceDue for a maintenance item from its most recent service
// record. Called after logging or deleting a ServiceRecord.
export async function refreshMaintenanceSchedule(itemId: string) {
  const [item, latest] = await Promise.all([
    prisma.maintenanceItem.findUnique({ where: { id: itemId } }),
    prisma.serviceRecord.findFirst({
      where: { itemId },
      orderBy: { servicedAt: "desc" },
    }),
  ]);
  if (!item) return null;

  const lastServicedAt = latest?.servicedAt ?? null;
  const nextServiceDue = lastServicedAt
    ? computeNextDue(lastServicedAt, item.serviceIntervalMonths)
    : null;

  return prisma.maintenanceItem.update({
    where: { id: itemId },
    data: {
      lastServicedAt,
      nextServiceDue,
      // Any previous reminder spawn is invalidated — logging a service clears
      // the "we already nagged about this" sentinel so the next cycle can
      // nag again when it falls due.
      lastReminderSpawnedAt: null,
    },
  });
}

export const DEVICE_TYPE_LABELS: Record<string, string> = {
  CAR: "Car",
  MOTORBIKE: "Motorbike",
  BICYCLE: "Bicycle",
  LAWNMOWER: "Lawnmower",
  HEDGE_TRIMMER: "Hedge trimmer",
  CHAINSAW: "Chainsaw",
  PRESSURE_WASHER: "Pressure washer",
  APPLIANCE: "Appliance",
  TOOL: "Tool",
  OTHER: "Other",
};

export const DEVICE_TYPE_ORDER = [
  "CAR",
  "MOTORBIKE",
  "BICYCLE",
  "LAWNMOWER",
  "HEDGE_TRIMMER",
  "CHAINSAW",
  "PRESSURE_WASHER",
  "APPLIANCE",
  "TOOL",
  "OTHER",
] as const;
