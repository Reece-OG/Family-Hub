import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { APP_NAME } from "@/lib/app-name";

export const runtime = "nodejs";

// GET /api/menu/shopping-pdf?from=ISO&to=ISO
//
// Consolidate every ingredient from every recipe in the menu window and
// render it as a print-ready shopping list. This does NOT mutate the live
// shopping list — it's a standalone export so the user can print without
// polluting what's already on the kitchen bench.

function dayKey(iso: string): Date {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new HttpError(400, "Invalid date");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type Merged = {
  name: string;
  quantity: string | null;
  category: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMenu")) {
      throw new HttpError(403, "No permission to view menu");
    }
    const url = new URL(req.url);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    if (!fromRaw || !toRaw) {
      throw new HttpError(400, "Missing 'from' or 'to' query parameter");
    }
    const from = dayKey(fromRaw);
    const to = dayKey(toRaw);

    const entries = await prisma.menuEntry.findMany({
      where: { date: { gte: from, lte: to }, recipeId: { not: null } },
      include: {
        recipe: { include: { ingredients: true } },
      },
      orderBy: [{ date: "asc" }, { mealType: "asc" }, { position: "asc" }],
    });

    // Merge ingredients across all menu entries in the window. Same logic as
    // /api/menu/to-shopping but we keep it local so changes to that endpoint
    // don't accidentally break the PDF output.
    const merged = new Map<string, Merged>();
    for (const entry of entries) {
      if (!entry.recipe) continue;
      for (const ing of entry.recipe.ingredients) {
        const key = ing.name.trim().toLowerCase();
        if (!key) continue;
        const qty =
          [ing.quantity, ing.unit].filter(Boolean).join(" ").trim() || null;
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, {
            name: ing.name,
            quantity: qty,
            category: ing.category ?? null,
          });
        } else {
          if (qty && (!existing.quantity || !existing.quantity.includes(qty))) {
            existing.quantity = existing.quantity
              ? `${existing.quantity} + ${qty}`
              : qty;
          }
          if (!existing.category && ing.category) existing.category = ing.category;
        }
      }
    }

    // Group by category.
    const items = Array.from(merged.values());
    const groups = new Map<string, Merged[]>();
    for (const it of items) {
      const cat = it.category && it.category.trim() ? it.category : "Other";
      const bucket = groups.get(cat) ?? [];
      bucket.push(it);
      groups.set(cat, bucket);
    }
    const CAT_ORDER = [
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
    const orderedCategories = Array.from(groups.keys()).sort((a, b) => {
      const ia = CAT_ORDER.indexOf(a);
      const ib = CAT_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    const rangeLabel = `${from.toISOString().slice(0, 10)} → ${to
      .toISOString()
      .slice(0, 10)}`;

    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      const pageRight = doc.page.width - doc.page.margins.right;

      // Header
      doc.fontSize(22).fillColor("#111").text("Menu Shopping List", {
        align: "left",
      });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(
          `Week ${rangeLabel}  •  ${APP_NAME}  •  ${items.length} unique item${
            items.length === 1 ? "" : "s"
          }`,
        );
      doc.moveDown(0.5);
      doc
        .strokeColor("#e5e7eb")
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(pageRight, doc.y)
        .stroke();
      doc.moveDown(0.75);

      if (items.length === 0) {
        doc
          .fontSize(12)
          .fillColor("#666")
          .text(
            "No recipes scheduled in this window, so there's nothing to shop for.",
          );
        doc.end();
        return;
      }

      for (const cat of orderedCategories) {
        const list = (groups.get(cat) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        if (list.length === 0) continue;

        doc.fontSize(13).fillColor("#111").text(cat);
        doc.moveDown(0.15);

        for (const it of list) {
          const label = it.quantity ? `${it.name}  ·  ${it.quantity}` : it.name;
          const boxSize = 10;
          const xBox = doc.page.margins.left;
          const y = doc.y + 2;

          doc
            .strokeColor("#333")
            .lineWidth(1)
            .rect(xBox, y, boxSize, boxSize)
            .stroke();

          const textX = xBox + boxSize + 6;
          doc
            .fontSize(11)
            .fillColor("#111")
            .text(label, textX, y - 2, {
              width: pageRight - textX,
              lineBreak: true,
            });

          doc.moveDown(0.35);
        }
        doc.moveDown(0.3);
      }

      doc.end();
    });

    const filename = `menu-shopping-${from.toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
