import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { deleteReceipt } from "@/lib/receipt-storage";

const lineItemSchema = z.object({
  // Existing rows keep their id so we can selectively update; new rows omit it.
  id: z.string().optional(),
  label: z.string().min(1).max(200),
  amount: z.number().finite(),
  categoryId: z.string().optional().nullable(),
});

const patchSchema = z.object({
  vendor: z.string().min(1).max(200).optional(),
  date: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
  // Replacing all line items at once is by far the simplest model for the UI
  // — the dialog edits the whole list, then sends the whole list back.
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

async function loadOwnedReceipt(ownerId: string, id: string) {
  const r = await prisma.taxReceipt.findUnique({ where: { id } });
  if (!r || r.ownerId !== ownerId) {
    throw new HttpError(404, "Receipt not found");
  }
  return r;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    await loadOwnedReceipt(me.id, params.id);
    const receipt = await prisma.taxReceipt.findUnique({
      where: { id: params.id },
      include: { lineItems: { orderBy: { position: "asc" } } },
    });
    return NextResponse.json({ receipt });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    await loadOwnedReceipt(me.id, params.id);
    const input = patchSchema.parse(await req.json());

    let date: Date | undefined;
    if (input.date !== undefined) {
      date = new Date(input.date);
      if (isNaN(date.getTime())) throw new HttpError(400, "Invalid date");
    }

    if (input.lineItems) {
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
    }

    const total = input.lineItems
      ? Math.round(
          input.lineItems.reduce((acc, l) => acc + l.amount, 0) * 100,
        ) / 100
      : undefined;

    // Replace line items wholesale when the client sends a new list. We do
    // this in a transaction so the receipt + lineItem rows always agree.
    const receipt = await prisma.$transaction(async (tx) => {
      if (input.lineItems) {
        await tx.taxLineItem.deleteMany({
          where: { receiptId: params.id },
        });
        await tx.taxLineItem.createMany({
          data: input.lineItems.map((l, i) => ({
            receiptId: params.id,
            label: l.label.trim(),
            amount: Math.round(l.amount * 100) / 100,
            categoryId: l.categoryId || null,
            position: i,
          })),
        });
      }
      return tx.taxReceipt.update({
        where: { id: params.id },
        data: {
          ...(input.vendor !== undefined ? { vendor: input.vendor.trim() } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(input.notes !== undefined
            ? { notes: input.notes?.trim() || null }
            : {}),
          ...(total !== undefined ? { totalAmount: total } : {}),
        },
        include: { lineItems: { orderBy: { position: "asc" } } },
      });
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    const r = await loadOwnedReceipt(me.id, params.id);
    if (r.fileFilename) {
      await deleteReceipt(r.fileFilename);
    }
    await prisma.taxReceipt.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
