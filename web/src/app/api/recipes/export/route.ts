import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { APP_NAME } from "@/lib/app-name";
import { readImage } from "@/lib/recipe-images";

export const runtime = "nodejs";

// GET /api/recipes/export — renders every recipe as a printable PDF cookbook.
// Each recipe gets its own page with servings/time chips, ingredients, and
// numbered instructions. Simple enough to drop into a ring binder.
//
// v4.7.5 — embeds the recipe's hero image (jpg/png) at the top of each
// page when present. WebP / GIF / external imageUrl are skipped because
// pdfkit only ships JPEG and PNG codecs; the recipe still renders, just
// without the picture.

// Pre-load image bytes for every recipe in parallel so the synchronous PDF
// pass below can drop them straight into the doc without awaiting.
async function loadHeroImages(
  rows: { id: string; imageFilename: string | null }[],
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  await Promise.all(
    rows.map(async (r) => {
      if (!r.imageFilename) return;
      const ext = r.imageFilename.split(".").pop()?.toLowerCase();
      if (ext !== "jpg" && ext !== "jpeg" && ext !== "png") return;
      const buf = await readImage(r.imageFilename);
      if (buf) out.set(r.id, buf);
    }),
  );
  return out;
}

export async function GET(_req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewRecipes")) {
      throw new HttpError(403, "No permission to view recipes");
    }

    const recipes = await prisma.recipe.findMany({
      include: { ingredients: { orderBy: { position: "asc" } } },
      orderBy: { title: "asc" },
    });

    // Load all hero images up-front so the synchronous PDF builder can pull
    // them from the map without an extra await per page.
    const heroImages = await loadHeroImages(recipes);

    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      const pageRight = doc.page.width - doc.page.margins.right;
      const contentWidth = pageRight - doc.page.margins.left;

      // ---- Cover ----------------------------------------------------------
      doc
        .fontSize(28)
        .fillColor("#111")
        .text("Family Cookbook", { align: "left" });
      doc.moveDown(0.25);
      doc
        .fontSize(11)
        .fillColor("#666")
        .text(
          `Generated ${new Date().toLocaleString()}  •  ${APP_NAME}  •  ${
            recipes.length
          } recipe${recipes.length === 1 ? "" : "s"}`,
        );
      doc.moveDown(0.6);
      doc
        .strokeColor("#e5e7eb")
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(pageRight, doc.y)
        .stroke();
      doc.moveDown(0.75);

      if (recipes.length === 0) {
        doc
          .fontSize(12)
          .fillColor("#666")
          .text(
            "No recipes yet. Add some in the Recipes tab and re-export to build your cookbook.",
          );
        doc.end();
        return;
      }

      // ---- Table of contents ---------------------------------------------
      doc.fontSize(14).fillColor("#111").text("Contents");
      doc.moveDown(0.3);
      for (const r of recipes) {
        doc
          .fontSize(11)
          .fillColor("#333")
          .text(`•  ${r.title}`, { continued: false });
      }

      // ---- One page per recipe -------------------------------------------
      for (const r of recipes) {
        doc.addPage();

        // Hero image, if we have one. We render it as a banner the full
        // content width with a fixed max height so portrait shots don't
        // push everything else off the page. fit:[w,h] preserves aspect
        // ratio; align centre keeps it tidy when the photo is narrower.
        const heroBuf = heroImages.get(r.id);
        if (heroBuf) {
          try {
            const maxH = 180;
            doc.image(heroBuf, doc.page.margins.left, doc.y, {
              fit: [contentWidth, maxH],
              align: "center",
              // valign defaults to top inside the fit box; pdfkit's typings
              // only allow "center" | "bottom" so we just leave it off.
            });
            // pdfkit's image() doesn't advance the cursor when fit[] is
            // used, so move down manually past the rendered area.
            doc.y = doc.y + maxH + 8;
          } catch {
            // Corrupt / unsupported file — silently skip the image and
            // keep rendering the recipe text. Better to ship the cookbook
            // than to 500 the whole export over one bad photo.
          }
        }

        doc.fontSize(20).fillColor("#111").text(r.title);
        doc.moveDown(0.2);

        if (r.description) {
          doc
            .fontSize(11)
            .fillColor("#444")
            .text(r.description, { width: contentWidth });
          doc.moveDown(0.3);
        }

        // Meta chips (servings · prep · cook · tags)
        const metaParts: string[] = [];
        if (r.servings) {
          metaParts.push(`Serves ${r.servings}`);
        }
        if (r.prepMinutes) {
          metaParts.push(`Prep ${r.prepMinutes}m`);
        }
        if (r.cookMinutes) {
          metaParts.push(`Cook ${r.cookMinutes}m`);
        }
        if (r.prepMinutes || r.cookMinutes) {
          metaParts.push(
            `Total ${(r.prepMinutes ?? 0) + (r.cookMinutes ?? 0)}m`,
          );
        }
        if (r.caloriesTotal != null) {
          metaParts.push(`${r.caloriesTotal} kcal total`);
        }
        if (r.caloriesPerServing != null) {
          metaParts.push(`${r.caloriesPerServing} kcal per serving`);
        }
        if (r.tags) metaParts.push(r.tags);
        if (metaParts.length > 0) {
          doc
            .fontSize(10)
            .fillColor("#666")
            .text(metaParts.join("  •  "));
          doc.moveDown(0.4);
        }

        doc
          .strokeColor("#e5e7eb")
          .lineWidth(1)
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(pageRight, doc.y)
          .stroke();
        doc.moveDown(0.5);

        // Ingredients
        doc.fontSize(13).fillColor("#111").text("Ingredients");
        doc.moveDown(0.2);
        if (r.ingredients.length === 0) {
          doc
            .fontSize(10)
            .fillColor("#888")
            .text("(none listed)");
        } else {
          for (const ing of r.ingredients) {
            const qty = [ing.quantity, ing.unit]
              .filter((s) => s && String(s).trim())
              .join(" ");
            const line = qty ? `${qty}  ${ing.name}` : ing.name;
            doc
              .fontSize(11)
              .fillColor("#222")
              .text(`•  ${line}`, { width: contentWidth });
          }
        }
        doc.moveDown(0.5);

        // Instructions
        doc.fontSize(13).fillColor("#111").text("Instructions");
        doc.moveDown(0.2);
        const steps = (r.instructions || "")
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length === 0) {
          doc
            .fontSize(10)
            .fillColor("#888")
            .text("(none)");
        } else {
          steps.forEach((step, idx) => {
            doc
              .fontSize(11)
              .fillColor("#222")
              .text(`${idx + 1}. ${step}`, { width: contentWidth });
            doc.moveDown(0.15);
          });
        }
      }

      doc.end();
    });

    const filename = `family-hub-cookbook-${new Date()
      .toISOString()
      .slice(0, 10)}.pdf`;

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
