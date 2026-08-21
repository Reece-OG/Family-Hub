import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { APP_NAME } from "@/lib/app-name";

export const runtime = "nodejs";

// GET /api/shopping/pdf — render the current shopping list as a printable
// PDF. Items are grouped by category, with open items rendered as empty
// check-boxes and done items shown struck-through so the printout mirrors
// the on-screen list exactly.

export async function GET(_req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewShopping")) {
      throw new HttpError(403, "No permission to view shopping list");
    }

    const items = await prisma.shoppingItem.findMany({
      orderBy: [
        { done: "asc" },
        { category: "asc" },
        { createdAt: "desc" },
      ],
    });

    // Bucket by category (preserving "done at bottom" for each group).
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const cat = it.category && it.category.trim() ? it.category : "Other";
      const bucket = groups.get(cat) ?? [];
      bucket.push(it);
      groups.set(cat, bucket);
    }
    // Sort categories: known ones in the standard order, unknown ones trailing.
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

    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      const pageRight = doc.page.width - doc.page.margins.right;

      // ---- Header ---------------------------------------------------------
      doc.fontSize(22).fillColor("#111").text("Shopping List", { align: "left" });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(
          `Generated ${new Date().toLocaleString()}  •  ${APP_NAME}  •  ${
            items.length
          } item${items.length === 1 ? "" : "s"}`,
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
          .text("Your shopping list is empty. 🎉");
        doc.end();
        return;
      }

      for (const cat of orderedCategories) {
        const list = groups.get(cat) ?? [];
        if (list.length === 0) continue;

        // Category heading
        doc
          .fontSize(13)
          .fillColor("#111")
          .text(cat, { underline: false });
        doc.moveDown(0.15);

        for (const it of list) {
          const label = it.quantity ? `${it.name}  ·  ${it.quantity}` : it.name;
          const boxSize = 10;
          const xBox = doc.page.margins.left;
          const y = doc.y + 2;

          // Checkbox
          doc
            .strokeColor(it.done ? "#22c55e" : "#333")
            .lineWidth(1)
            .rect(xBox, y, boxSize, boxSize)
            .stroke();
          if (it.done) {
            // Checkmark: two-segment tick inside the box.
            doc
              .strokeColor("#22c55e")
              .lineWidth(1.5)
              .moveTo(xBox + 2, y + boxSize / 2)
              .lineTo(xBox + boxSize / 2 - 1, y + boxSize - 2)
              .lineTo(xBox + boxSize - 1, y + 2)
              .stroke();
          }

          const textX = xBox + boxSize + 6;
          doc
            .fontSize(11)
            .fillColor(it.done ? "#888" : "#111")
            .text(label, textX, y - 2, {
              width: pageRight - textX,
              lineBreak: true,
            });

          if (it.done) {
            // Strikethrough — draw across the text line.
            const textWidth = Math.min(
              doc.widthOfString(label),
              pageRight - textX,
            );
            const strikeY = y + 4;
            doc
              .strokeColor("#999")
              .lineWidth(0.8)
              .moveTo(textX, strikeY)
              .lineTo(textX + textWidth, strikeY)
              .stroke();
          }

          doc.moveDown(0.35);
        }

        doc.moveDown(0.3);
      }

      doc.end();
    });

    const filename = `shopping-list-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;

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
