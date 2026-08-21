import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { DEVICE_TYPE_LABELS } from "@/lib/maintenance";
import { APP_NAME } from "@/lib/app-name";

export const runtime = "nodejs";

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtMoney(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(2);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMaintenance")) {
      throw new HttpError(403, "No permission to view maintenance");
    }

    const item = await prisma.maintenanceItem.findUnique({
      where: { id: params.id },
      include: {
        owner: { select: { id: true, name: true } },
        serviceRecords: {
          orderBy: { servicedAt: "desc" },
          include: {
            loggedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!item) throw new HttpError(404, "Maintenance item not found");

    // Build PDF in-memory. pdfkit emits Buffers via 'data'/'end' events.
    const pdfBuffer: Buffer = await new Promise((resolve, reject) => {
      // No custom font — rely on the built-in Helvetica bundled with pdfkit.
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      // ---- Header -----------------------------------------------------
      doc
        .fontSize(20)
        .fillColor("#111")
        .text("Maintenance Record", { align: "left" });
      doc.moveDown(0.25);
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(`Generated ${new Date().toLocaleString()}  •  ${APP_NAME}`);
      doc.moveDown(0.75);

      // Divider
      doc
        .strokeColor("#e5e7eb")
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.75);

      // ---- Device details --------------------------------------------
      doc.fontSize(16).fillColor("#111").text(item.name);
      doc.moveDown(0.25);

      const typeLabel = DEVICE_TYPE_LABELS[item.deviceType] ?? item.deviceType;
      const metaLines: string[] = [
        `Type: ${typeLabel}`,
        `Service interval: every ${item.serviceIntervalMonths} month${
          item.serviceIntervalMonths === 1 ? "" : "s"
        }`,
        `Last serviced: ${fmtDate(item.lastServicedAt)}`,
        `Next service due: ${fmtDate(item.nextServiceDue)}`,
        `Owner: ${item.owner?.name ?? "—"}`,
      ];
      if (item.identifier) {
        metaLines.unshift(`Identifier: ${item.identifier}`);
      }

      doc.fontSize(11).fillColor("#333");
      for (const line of metaLines) {
        doc.text(line);
      }
      doc.moveDown(0.5);

      if (item.notes) {
        doc
          .fontSize(11)
          .fillColor("#111")
          .text("Notes", { underline: false });
        doc.fontSize(10).fillColor("#333").text(item.notes, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        });
        doc.moveDown(0.5);
      }

      // ---- Service history -------------------------------------------
      doc.moveDown(0.25);
      doc
        .strokeColor("#e5e7eb")
        .lineWidth(1)
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.75);

      doc.fontSize(14).fillColor("#111").text("Service history");
      doc.moveDown(0.25);

      if (item.serviceRecords.length === 0) {
        doc
          .fontSize(10)
          .fillColor("#666")
          .text("No service records have been logged yet.");
      } else {
        for (const r of item.serviceRecords) {
          // Title line — date + who
          doc
            .fontSize(11)
            .fillColor("#111")
            .text(
              `${fmtDate(r.servicedAt)}${
                r.performedBy ? `  •  by ${r.performedBy}` : ""
              }`,
              { continued: false },
            );

          // Meta line (cost + logger)
          const metaBits: string[] = [];
          if (r.cost !== null && r.cost !== undefined) {
            metaBits.push(`Cost: ${fmtMoney(r.cost)}`);
          }
          if (r.loggedBy?.name) {
            metaBits.push(`Logged by ${r.loggedBy.name}`);
          }
          if (metaBits.length > 0) {
            doc.fontSize(9).fillColor("#666").text(metaBits.join("  •  "));
          }

          // Work done
          doc.fontSize(10).fillColor("#333").text(r.workDone, {
            width:
              doc.page.width - doc.page.margins.left - doc.page.margins.right,
          });
          if (r.notes) {
            doc
              .fontSize(9)
              .fillColor("#555")
              .text(r.notes, {
                width:
                  doc.page.width -
                  doc.page.margins.left -
                  doc.page.margins.right,
              });
          }
          doc.moveDown(0.5);

          // Row divider
          doc
            .strokeColor("#f1f5f9")
            .lineWidth(1)
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .stroke();
          doc.moveDown(0.4);
        }
      }

      doc.end();
    });

    // Safe filename. Strip anything that could break Content-Disposition.
    const safeName = item.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) ||
      "maintenance";
    const filename = `${safeName}-service-record.pdf`;

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
