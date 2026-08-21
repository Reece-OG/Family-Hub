// Helpers for the My Taxes feature.
//
// Three responsibilities live here:
//   1. Financial-year date math (which window does a given date fall into,
//      and how do we render it in the UI / on the PDF).
//   2. First-time seeding of an ATO-style starter category list per user.
//   3. The Maintenance → vehicle-expenses bridge used by both the summary
//      endpoint and the PDF export. We treat any MaintenanceItem with
//      deviceType ∈ {CAR, MOTORBIKE} as a "vehicle" for tax purposes.
//
// Categories drawn from the ATO's "deductions you can claim" guidance at
// https://www.ato.gov.au/individuals/income-deductions-offsets-and-records/.
// Hints are short and intentionally generic; the user can rename or hide
// any of them.

import { prisma } from "./prisma";
import { getSettings } from "./settings";

// ---------- Financial year ----------

export type FinancialYear = {
  // ISO date strings (UTC midnight) — start inclusive, endExclusive exclusive.
  startISO: string;
  endExclusiveISO: string;
  // Human label, e.g. "FY 2025–26" or "FY 2025" depending on whether the
  // window crosses a calendar year. AU users see the former.
  label: string;
  // Stable key the UI uses to round-trip selection through the URL: the
  // calendar year of the start date (so AU FY25/26 has key 2025).
  key: number;
};

function clampDay(month: number, day: number): { month: number; day: number } {
  // Postgres-friendly clamp — schema already restricts day to 1–28 via the
  // settings UI, but be defensive against hand-edited DBs.
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  const d = Math.min(28, Math.max(1, Math.trunc(day)));
  return { month: m, day: d };
}

export async function getFinancialYearWindow(now: Date = new Date()): Promise<FinancialYear> {
  const s = await getSettings();
  return computeFinancialYear(s.financialYearStartMonth, s.financialYearStartDay, now);
}

export function computeFinancialYear(
  startMonth: number,
  startDay: number,
  now: Date = new Date(),
): FinancialYear {
  const { month, day } = clampDay(startMonth, startDay);
  const y = now.getUTCFullYear();
  // Window that *contains* `now`: pick startYear so that
  //   start <= now < startNext
  const candidateStart = new Date(Date.UTC(y, month - 1, day));
  const startYear = now.getTime() >= candidateStart.getTime() ? y : y - 1;
  return windowFor(month, day, startYear);
}

export function computeFinancialYearByKey(
  startMonth: number,
  startDay: number,
  key: number,
): FinancialYear {
  const { month, day } = clampDay(startMonth, startDay);
  return windowFor(month, day, key);
}

function windowFor(month: number, day: number, startYear: number): FinancialYear {
  const start = new Date(Date.UTC(startYear, month - 1, day));
  const endExclusive = new Date(Date.UTC(startYear + 1, month - 1, day));
  // FY label only crosses calendar years when the start month isn't January.
  const label =
    month === 1 && day === 1
      ? `FY ${startYear}`
      : `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
  return {
    startISO: start.toISOString(),
    endExclusiveISO: endExclusive.toISOString(),
    label,
    key: startYear,
  };
}

// ---------- Vehicle-expenses bridge ----------

export type VehicleExpenseRow = {
  itemId: string;
  itemName: string;
  identifier: string | null;
  servicedAt: Date;
  performedBy: string | null;
  workDone: string;
  cost: number; // 0 when the record has no cost recorded
};

export type VehicleExpenseGroup = {
  itemId: string;
  itemName: string;
  identifier: string | null;
  rows: VehicleExpenseRow[];
  subtotal: number;
};

export async function getVehicleExpenses(opts: {
  ownerId: string;
  fy: FinancialYear;
}): Promise<VehicleExpenseGroup[]> {
  const items = await prisma.maintenanceItem.findMany({
    where: {
      ownerId: opts.ownerId,
      deviceType: { in: ["CAR", "MOTORBIKE"] },
    },
    include: {
      serviceRecords: {
        where: {
          servicedAt: {
            gte: new Date(opts.fy.startISO),
            lt: new Date(opts.fy.endExclusiveISO),
          },
        },
        orderBy: { servicedAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return items
    .map((item) => {
      const rows: VehicleExpenseRow[] = item.serviceRecords.map((r) => ({
        itemId: item.id,
        itemName: item.name,
        identifier: item.identifier,
        servicedAt: r.servicedAt,
        performedBy: r.performedBy,
        workDone: r.workDone,
        cost: r.cost ? Number(r.cost) : 0,
      }));
      const subtotal = rows.reduce((acc, r) => acc + r.cost, 0);
      return {
        itemId: item.id,
        itemName: item.name,
        identifier: item.identifier,
        rows,
        subtotal,
      };
    })
    .filter((g) => g.rows.length > 0);
}

// ---------- Category seed ----------

// ATO-style starter categories. Keep the list short and broadly useful;
// users can extend as needed. Hints reference the ATO occupation/industry
// pages without quoting them so the wording stays our own.
const STARTER_CATEGORIES: { name: string; hint: string }[] = [
  { name: "Tools & equipment", hint: "Hand tools, drill bits, gear used for work" },
  { name: "Travel", hint: "Flights, accommodation, taxi/ride-share for work travel" },
  { name: "Vehicle", hint: "Fuel, servicing, registration if you claim vehicle costs" },
  { name: "Self-education", hint: "Course fees, textbooks, conference tickets" },
  { name: "Home office", hint: "Power/heating share, desk, chair, monitor for WFH" },
  { name: "Phone & internet", hint: "Work-use share of mobile + home internet" },
  { name: "Uniform & PPE", hint: "Branded uniforms, safety boots, hi-vis, laundering" },
  { name: "Union & professional fees", hint: "Membership, subscription to industry body" },
  { name: "Donations", hint: "Gifts to a deductible-gift-recipient charity" },
  { name: "Other deductible", hint: "Anything that doesn't fit the above" },
];

export async function ensureStarterCategories(ownerId: string): Promise<void> {
  // Only seed when the user has zero categories so a returning user who
  // deliberately deleted one doesn't have it auto-resurrected.
  const count = await prisma.taxCategory.count({ where: { ownerId } });
  if (count > 0) return;
  await prisma.taxCategory.createMany({
    data: STARTER_CATEGORIES.map((c, i) => ({
      ownerId,
      name: c.name,
      hint: c.hint,
      position: i,
      isStarter: true,
    })),
  });
}
