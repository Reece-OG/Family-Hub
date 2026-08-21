import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
import {
  computeFinancialYearByKey,
  getFinancialYearWindow,
  getVehicleExpenses,
} from "@/lib/taxes";
import { getSettings } from "@/lib/settings";

// GET /api/taxes/summary?fy=<startYear>
//
// Returns category subtotals, the running grand total, and the auto-rolled
// vehicle subtotal pulled from Maintenance for the requested financial year.
// Powers both the headline card on the Taxes page and the "FY at a glance"
// section of the PDF export.
export async function GET(req: NextRequest) {
  try {
    const me = await requirePrivateUser();
    const url = new URL(req.url);
    const fyKeyRaw = url.searchParams.get("fy");
    const settings = await getSettings();
    const fy =
      fyKeyRaw && /^\d{4}$/.test(fyKeyRaw)
        ? computeFinancialYearByKey(
            settings.financialYearStartMonth,
            settings.financialYearStartDay,
            Number(fyKeyRaw),
          )
        : await getFinancialYearWindow();

    // Pull every line item for this user inside the FY (joined back to the
    // receipt so we can filter by date) plus the user's category list to
    // attach names to the subtotals.
    const [lineItems, categories, vehicleGroups] = await Promise.all([
      prisma.taxLineItem.findMany({
        where: {
          receipt: {
            ownerId: me.id,
            date: {
              gte: new Date(fy.startISO),
              lt: new Date(fy.endExclusiveISO),
            },
          },
        },
        select: {
          amount: true,
          categoryId: true,
        },
      }),
      prisma.taxCategory.findMany({
        where: { ownerId: me.id, hidden: false },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
      getVehicleExpenses({ ownerId: me.id, fy }),
    ]);

    // Build totals — keyed by categoryId, with a sentinel "" for uncategorised.
    const totalsByCategory = new Map<string, number>();
    let grand = 0;
    for (const li of lineItems) {
      const amt = Number(li.amount);
      grand += amt;
      const key = li.categoryId ?? "";
      totalsByCategory.set(key, (totalsByCategory.get(key) ?? 0) + amt);
    }
    grand = Math.round(grand * 100) / 100;

    const categoryRows = categories.map((c) => ({
      id: c.id,
      name: c.name,
      hint: c.hint,
      subtotal:
        Math.round((totalsByCategory.get(c.id) ?? 0) * 100) / 100,
    }));

    const uncategorisedSubtotal =
      Math.round((totalsByCategory.get("") ?? 0) * 100) / 100;

    const vehicleSubtotal =
      Math.round(
        vehicleGroups.reduce((acc, g) => acc + g.subtotal, 0) * 100,
      ) / 100;

    return NextResponse.json({
      fy,
      grandTotal: grand,
      categoryRows,
      uncategorisedSubtotal,
      vehicle: {
        subtotal: vehicleSubtotal,
        groups: vehicleGroups.map((g) => ({
          itemId: g.itemId,
          itemName: g.itemName,
          identifier: g.identifier,
          subtotal: Math.round(g.subtotal * 100) / 100,
          recordCount: g.rows.length,
        })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
