import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import {
  computeFinancialYearByKey,
  getFinancialYearWindow,
} from "@/lib/taxes";
import { getSettings } from "@/lib/settings";

// GET /api/taxes/receipts?fy=<startYear>
// Returns the caller's receipts in the requested financial year (defaulting
// to the current FY). Each row includes its line items. Owner-scoped — a
// missing/wrong session yields 401/403 well before any DB read.
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

    const receipts = await prisma.taxReceipt.findMany({
      where: {
        ownerId: me.id,
        date: {
          gte: new Date(fy.startISO),
          lt: new Date(fy.endExclusiveISO),
        },
      },
      include: {
        lineItems: {
          orderBy: { position: "asc" },
        },
      },
      orderBy: { date: "desc" },
    });
    return NextResponse.json({ receipts, fy });
  } catch (e) {
    return handleError(e);
  }
}

const lineItemSchema = z.object({
  label: z.string().min(1).max(200),
  amount: z.number().finite(),
  categoryId: z.string().optional().nullable(),
});

const createSchema = z.object({
  vendor: z.string().min(1).max(200),
  date: z.string(), // ISO date
  notes: z.string().max(2000).optional().nullable(),
  lineItems: z.array(lineItemSchema).min(1),
});

function sumLines(lines: { amount: number }[]) {
  // Round to cents on the way in so we don't carry floating-point fuzz to
  // the Decimal column.
  return Math.round(lines.reduce((acc, l) => acc + l.amount, 0) * 100) / 100;
}

export async function POST(req: NextRequest) {
  try {
    const me = await requirePrivateUser();
    const input = createSchema.parse(await req.json());
    const date = new Date(input.date);
    if (isNaN(date.getTime())) throw new HttpError(400, "Invalid date");

    // Reject any categoryId that doesn't belong to the caller. Cheap one-shot
    // query rather than per-line; treats the whole receipt as suspect if any
    // line is wrong.
    const refIds = input.lineItems
      .map((l) => l.categoryId)
      .filter((x): x is string => Boolean(x));
    if (refIds.length > 0) {
      const ok = await prisma.taxCategory.findMany({
        where: { id: { in: refIds }, ownerId: me.id },
        select: { id: true },
      });
      const okSet = new Set(ok.map((c) => c.id));
      if (refIds.some((id) => !okSet.has(id))) {
        throw new HttpError(400, "Category not found");
      }
    }

    const total = sumLines(input.lineItems);
    const receipt = await prisma.taxReceipt.create({
      data: {
        ownerId: me.id,
        vendor: input.vendor.trim(),
        date,
        notes: input.notes?.trim() || null,
        totalAmount: total,
        lineItems: {
          create: input.lineItems.map((l, i) => ({
            label: l.label.trim(),
            amount: Math.round(l.amount * 100) / 100,
            categoryId: l.categoryId || null,
            position: i,
          })),
        },
      },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json({ receipt });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
