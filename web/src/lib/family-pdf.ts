// =============================================================================
//  Family Hub — Take-it-with-you PDF (v4.7.8)
// =============================================================================
//
//  Renders every family-facing model into a single, printable A4 PDF.
//  AppSettings is intentionally NOT exported — this is the document a
//  family takes with them when leaving the app, not a backup.
//
//  Section order roughly mirrors the in-app navigation so it's easy to
//  hand to someone unfamiliar with the product.

import PDFDocument from "pdfkit";
import { prisma } from "./prisma";
import { APP_NAME } from "./app-name";
import { readPhoto } from "./photo-storage";
import { readImage as readRecipeImage } from "./recipe-images";
import { readRewardImage } from "./reward-images";
import { addYears } from "date-fns";
import { expandOccurrences, ruleFromRow } from "./recurrence";

// pdfkit doesn't expose its `PDFKit` namespace cleanly under this tsconfig
// (the existing /api/recipes/export route just lets the doc type infer
// from `new PDFDocument(...)`), so we mirror that here with an instance
// type alias and a loose record for the image-embed helper's options
// since pdfkit's `image()` is overloaded and `Parameters<>` only sees
// one signature.
type Doc = InstanceType<typeof PDFDocument>;
// Trimmed to ONLY the fields safeImageEmbed actually passes. Earlier
// drafts mirrored pdfkit's full Mixins.ImageOption shape, which kept
// breaking the build whenever pdfkit's typings disagreed with our
// guess (align: "left" vs. "center"|"right", goTo: string vs.
// AnnotationOption, etc.). This trimmed shape is structurally
// assignable to pdfkit's ImageOption regardless of how its other
// optional fields are typed, because we just don't include them.
type ImageOption = {
  fit?: [number, number];
  align?: "center" | "right";
};

// -----------------------------------------------------------------------------
//  Layout helpers
// -----------------------------------------------------------------------------

function pageRight(doc: Doc): number {
  return doc.page.width - doc.page.margins.right;
}
function pageBottom(doc: Doc): number {
  return doc.page.height - doc.page.margins.bottom;
}
function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > pageBottom(doc)) doc.addPage();
}
function divider(doc: Doc) {
  doc
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(pageRight(doc), doc.y)
    .stroke();
  doc.moveDown(0.5);
}
function sectionTitle(doc: Doc, title: string) {
  ensureSpace(doc, 60);
  doc
    .fontSize(20)
    .fillColor("#111")
    .font("Helvetica-Bold")
    .text(title, { align: "left" });
  doc.font("Helvetica");
  doc.moveDown(0.2);
  divider(doc);
}
function subSection(doc: Doc, title: string) {
  ensureSpace(doc, 40);
  doc
    .fontSize(14)
    .fillColor("#111")
    .font("Helvetica-Bold")
    .text(title);
  doc.font("Helvetica");
  doc.moveDown(0.2);
}
function bodyText(doc: Doc, text: string) {
  doc.fontSize(11).fillColor("#222").text(text);
}
function bullet(doc: Doc, text: string) {
  ensureSpace(doc, 18);
  doc.fontSize(11).fillColor("#222").text(`•  ${text}`, {
    width: pageRight(doc) - doc.page.margins.left,
  });
}
function kv(doc: Doc, k: string, v: string) {
  ensureSpace(doc, 18);
  doc.fontSize(10).fillColor("#666").text(k, doc.page.margins.left, doc.y, {
    continued: true,
  });
  doc.fillColor("#111").text(`  ${v}`);
}
function emptyNote(doc: Doc, text: string) {
  doc.fontSize(10).fillColor("#888").text(text);
  doc.moveDown(0.4);
}
function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtMoney(n: number | string | null | undefined): string {
  const num = typeof n === "string" ? Number(n) : n ?? 0;
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
    currencyDisplay: "narrowSymbol",
  });
}

// pdfkit's image() throws on unsupported formats. JPEG and PNG are
// safe; everything else (WebP, GIF, missing file, corrupt) is skipped
// silently so the export always completes.
function safeImageEmbed(
  doc: Doc,
  buf: Buffer | null,
  filename: string | null,
  options: ImageOption,
) {
  if (!buf || !filename) return false;
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext !== "jpg" && ext !== "jpeg" && ext !== "png") return false;
  try {
    doc.image(buf, options);
    return true;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
//  Main entry point
// -----------------------------------------------------------------------------

export async function buildFamilyPdf(args: {
  exportedByName: string;
}): Promise<Buffer> {
  // Pull every model up-front — the PDF builder is synchronous-ish so it
  // mustn't stop to await Prisma calls mid-stream.
  const [
    users,
    perms,
    todoCategories,
    rewardCategories,
    taxCategories,
    rewardItems,
    events,
    eventReminders,
    eventParticipants,
    birthdays,
    recipes,
    recipeIngredients,
    menuEntries,
    photos,
    maintenanceItems,
    serviceRecords,
    taxReceipts,
    taxLineItems,
    shoppingItems,
    reminders,
    points,
    rewardRedemptions,
    todos,
    holidays,
  ] = await Promise.all([
    prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    prisma.userPermissions.findMany(),
    prisma.todoCategory.findMany({ orderBy: { position: "asc" } }),
    prisma.rewardCategory.findMany({ orderBy: { position: "asc" } }),
    prisma.taxCategory.findMany({ orderBy: { position: "asc" } }),
    prisma.rewardItem.findMany({
      include: { category: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    }),
    prisma.event.findMany({ orderBy: { startAt: "asc" } }),
    prisma.eventReminder.findMany(),
    prisma.eventParticipant.findMany(),
    prisma.birthday.findMany({ orderBy: { dateOfBirth: "asc" } }),
    prisma.recipe.findMany({
      include: { ingredients: { orderBy: { position: "asc" } } },
      orderBy: { title: "asc" },
    }),
    prisma.recipeIngredient.findMany(),
    prisma.menuEntry.findMany({
      include: { recipe: true },
      orderBy: [{ date: "asc" }, { mealType: "asc" }, { position: "asc" }],
    }),
    prisma.photo.findMany({
      include: { uploadedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.maintenanceItem.findMany({
      include: { owner: true },
      orderBy: { name: "asc" },
    }),
    prisma.serviceRecord.findMany({
      include: { item: true, loggedBy: true },
      orderBy: { servicedAt: "desc" },
    }),
    prisma.taxReceipt.findMany({
      include: { owner: true, lineItems: true },
      orderBy: { date: "desc" },
    }),
    prisma.taxLineItem.findMany({ include: { category: true } }),
    prisma.shoppingItem.findMany({
      include: { addedBy: true },
      orderBy: [{ done: "asc" }, { category: "asc" }, { createdAt: "desc" }],
    }),
    prisma.reminder.findMany({
      include: { user: true },
      orderBy: { remindAt: "desc" },
    }),
    prisma.pointsTransaction.findMany({
      include: { child: true, awardedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.rewardRedemption.findMany({
      include: { child: true, rewardItem: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.todo.findMany({
      include: { createdBy: true, assignee: true, category: true },
      orderBy: [{ done: "asc" }, { dueAt: "asc" }],
    }),
    prisma.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);
  void perms; // not surfaced in the family PDF — implicit through role
  void eventParticipants; // shown via the event itself
  void recipeIngredients; // already on the recipe rows
  void taxLineItems; // shown via the receipt rows
  void rewardCategories; // shown via the item rows
  void todoCategories; // shown via todo rows
  void taxCategories; // shown via line items

  // Pre-load images we'll embed so the synchronous PDF pass below has them
  // ready. Best-effort — a missing file just means a text-only render.
  const recipeImages = new Map<string, Buffer>();
  for (const r of recipes) {
    if (!r.imageFilename) continue;
    const buf = await readRecipeImage(r.imageFilename);
    if (buf) recipeImages.set(r.id, buf);
  }
  const photoBufs = new Map<string, Buffer>();
  for (const p of photos.slice(0, 60)) {
    // Cap at 60 pictures so a family with thousands of photos doesn't
    // pour the whole album into the document. The cover note will
    // explain this.
    const buf = await readPhoto(p.filename);
    if (buf) photoBufs.set(p.id, buf);
  }
  const rewardBufs = new Map<string, Buffer>();
  for (const it of rewardItems) {
    if (!it.imageFilename) continue;
    const buf = await readRewardImage(it.imageFilename);
    if (buf) rewardBufs.set(it.id, buf);
  }

  // ----- Build the PDF -----
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    // Cover ----------------------------------------------------------------
    doc
      .fontSize(28)
      .fillColor("#111")
      .font("Helvetica-Bold")
      .text(`${APP_NAME} — Family export`);
    doc.font("Helvetica");
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor("#666").text(
      `Generated ${new Date().toLocaleString("en-AU")} by ${args.exportedByName}.`,
    );
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor("#666")
      .text(
        "This document is a take-it-with-you snapshot of every family-facing thing in the app: the calendar, birthdays, to-dos, shopping list, menu plan, recipes, photo captions, reminders, rewards ledger, maintenance log, and any tax records. App settings (themes, SMTP, weather provider, etc.) are intentionally not included.",
        { width: pageRight(doc) - doc.page.margins.left },
      );
    doc.moveDown(0.6);
    divider(doc);

    // Members --------------------------------------------------------------
    sectionTitle(doc, "Family members");
    if (users.length === 0) {
      emptyNote(doc, "No members.");
    } else {
      for (const u of users) {
        ensureSpace(doc, 30);
        doc
          .fontSize(12)
          .fillColor("#111")
          .font("Helvetica-Bold")
          .text(`${u.avatarEmoji}  ${u.name}`, { continued: true });
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#666")
          .text(`   ${u.role.toLowerCase()}`);
        if (u.dateOfBirth) {
          kv(doc, "Date of birth", fmtDate(u.dateOfBirth));
        }
        kv(doc, "Email", u.email);
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(0.5);

    // Calendar (12 months either side) -------------------------------------
    sectionTitle(doc, "Calendar — past 12 / next 12 months");
    {
      const now = new Date();
      const from = addYears(now, -1);
      const to = addYears(now, 1);
      type Occ = { start: Date; end: Date; title: string; allDay: boolean; recur: boolean };
      const all: Occ[] = [];
      for (const e of events) {
        const rule = ruleFromRow({
          recurrenceFrequency: e.recurrenceFrequency,
          recurrenceInterval: e.recurrenceInterval,
          recurrenceByWeekday: e.recurrenceByWeekday,
          recurrenceEndDate: e.recurrenceEndDate,
          recurrenceEndCount: e.recurrenceEndCount,
        });
        const seed = {
          id: e.id,
          startAt: new Date(e.startAt),
          endAt: new Date(e.endAt),
          recurrence: rule,
        };
        const occs = expandOccurrences(seed, from, to);
        for (const o of occs) {
          all.push({
            start: o.occurrenceStart,
            end: o.occurrenceEnd,
            title: e.title,
            allDay: e.allDay,
            recur: o.isRecurringInstance,
          });
        }
      }
      all.sort((a, b) => a.start.getTime() - b.start.getTime());

      // Group by year-month label
      const byMonth = new Map<string, Occ[]>();
      for (const o of all) {
        const key = `${o.start.getFullYear()}-${String(o.start.getMonth() + 1).padStart(2, "0")}`;
        const arr = byMonth.get(key) ?? [];
        arr.push(o);
        byMonth.set(key, arr);
      }
      if (byMonth.size === 0) {
        emptyNote(doc, "No events in the +/- 12-month window.");
      } else {
        for (const [key, arr] of byMonth) {
          const [y, m] = key.split("-");
          const label = new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-AU", {
            month: "long",
            year: "numeric",
          });
          subSection(doc, label);
          for (const o of arr) {
            const dt = o.allDay
              ? fmtDate(o.start)
              : fmtDateTime(o.start);
            bullet(
              doc,
              `${dt} — ${o.title}${o.recur ? "  (recurring)" : ""}`,
            );
          }
          doc.moveDown(0.3);
        }
      }
    }
    doc.moveDown(0.4);

    // Holidays (compact) ---------------------------------------------------
    if (holidays.length > 0) {
      sectionTitle(doc, "Public holidays cached");
      for (const h of holidays.slice(0, 80)) {
        bullet(doc, `${fmtDate(h.date)} — ${h.localName ?? h.name} (${h.countryCode})`);
      }
      if (holidays.length > 80) {
        doc.fontSize(9).fillColor("#666").text(
          `…and ${holidays.length - 80} more.`,
        );
      }
      doc.moveDown(0.4);
    }

    // Birthdays ------------------------------------------------------------
    sectionTitle(doc, "Birthdays");
    if (birthdays.length === 0) {
      emptyNote(doc, "No birthdays added.");
    } else {
      for (const b of birthdays) {
        const ageInfo = b.yearKnown
          ? ` (${new Date().getFullYear() - new Date(b.dateOfBirth).getFullYear()} this year)`
          : "";
        bullet(doc, `${b.avatarEmoji}  ${b.name} — ${fmtDate(b.dateOfBirth)}${ageInfo}`);
      }
    }
    doc.moveDown(0.4);

    // To-dos ---------------------------------------------------------------
    sectionTitle(doc, "To-dos");
    {
      const open = todos.filter((t) => !t.done);
      const done = todos.filter((t) => t.done).slice(0, 50);
      subSection(doc, "Open");
      if (open.length === 0) emptyNote(doc, "No open to-dos.");
      else {
        for (const t of open) {
          const parts = [t.title];
          if (t.dueAt) parts.push(`due ${fmtDate(t.dueAt)}`);
          if (t.assignee) parts.push(`for ${t.assignee.name}`);
          if (t.pointsReward > 0) parts.push(`${t.pointsReward} pts`);
          bullet(doc, parts.join("  ·  "));
        }
      }
      subSection(doc, "Recently completed");
      if (done.length === 0) emptyNote(doc, "No completed to-dos.");
      else {
        for (const t of done) {
          bullet(doc, `${t.title}${t.assignee ? ` — ${t.assignee.name}` : ""}`);
        }
        if (todos.filter((t) => t.done).length > 50) {
          doc.fontSize(9).fillColor("#666").text(`…older entries omitted.`);
        }
      }
    }
    doc.moveDown(0.4);

    // Shopping list --------------------------------------------------------
    sectionTitle(doc, "Shopping list (current state)");
    if (shoppingItems.length === 0) {
      emptyNote(doc, "Empty.");
    } else {
      for (const it of shoppingItems) {
        const qty = it.quantity ? `  (${it.quantity})` : "";
        const cat = it.category ? `  [${it.category}]` : "";
        const prefix = it.done ? "✓" : "•";
        bullet(doc, `${prefix} ${it.name}${qty}${cat}`);
      }
    }
    doc.moveDown(0.4);

    // Menu plan ------------------------------------------------------------
    sectionTitle(doc, "Menu plan");
    if (menuEntries.length === 0) {
      emptyNote(doc, "No meals scheduled.");
    } else {
      const byDay = new Map<string, typeof menuEntries>();
      for (const m of menuEntries) {
        const key = new Date(m.date).toISOString().slice(0, 10);
        const arr = byDay.get(key) ?? [];
        arr.push(m);
        byDay.set(key, arr);
      }
      for (const [day, arr] of byDay) {
        subSection(
          doc,
          new Date(day).toLocaleDateString("en-AU", {
            weekday: "long",
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        );
        for (const m of arr) {
          const title = m.recipe?.title ?? m.freeformTitle ?? "(unnamed)";
          bullet(doc, `${m.mealType.toLowerCase()} — ${title}`);
        }
        doc.moveDown(0.2);
      }
    }
    doc.moveDown(0.4);

    // Recipes (one per page, with hero image) ------------------------------
    sectionTitle(doc, "Recipes");
    if (recipes.length === 0) {
      emptyNote(doc, "No recipes yet.");
    } else {
      for (const r of recipes) {
        doc.addPage();
        const buf = recipeImages.get(r.id);
        if (buf) {
          safeImageEmbed(doc, buf, r.imageFilename, {
            fit: [pageRight(doc) - doc.page.margins.left, 180],
            align: "center",
          });
          doc.y = doc.y + 188;
        }
        doc.fontSize(20).fillColor("#111").font("Helvetica-Bold").text(r.title);
        doc.font("Helvetica");
        doc.moveDown(0.2);
        if (r.description) bodyText(doc, r.description);
        doc.moveDown(0.2);
        const meta: string[] = [];
        if (r.servings) meta.push(`Serves ${r.servings}`);
        if (r.prepMinutes) meta.push(`Prep ${r.prepMinutes}m`);
        if (r.cookMinutes) meta.push(`Cook ${r.cookMinutes}m`);
        if (r.tags) meta.push(r.tags);
        if (meta.length > 0) {
          doc.fontSize(9).fillColor("#666").text(meta.join("  ·  "));
        }
        doc.moveDown(0.4);
        subSection(doc, "Ingredients");
        if (r.ingredients.length === 0) emptyNote(doc, "(none listed)");
        else {
          for (const ing of r.ingredients) {
            const qty =
              [ing.quantity, ing.unit].filter((s) => s && String(s).trim()).join(" ") ||
              "";
            bullet(doc, qty ? `${qty}  ${ing.name}` : ing.name);
          }
        }
        doc.moveDown(0.3);
        subSection(doc, "Instructions");
        const steps = (r.instructions || "")
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (steps.length === 0) emptyNote(doc, "(none)");
        else steps.forEach((s, i) => bullet(doc, `${i + 1}. ${s}`));
      }
    }
    if (recipes.length > 0) doc.addPage();

    // Photos thumbnail grid -----------------------------------------------
    sectionTitle(doc, "Photos");
    if (photos.length === 0) {
      emptyNote(doc, "No photos uploaded.");
    } else {
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(
          `Up to 60 most recent photos shown — ${photos.length} total in the library.`,
        );
      doc.moveDown(0.3);
      // Two-column thumbnail grid
      const colWidth = (pageRight(doc) - doc.page.margins.left - 12) / 2;
      const thumbH = 110;
      let col = 0;
      for (const p of photos.slice(0, 60)) {
        const buf = photoBufs.get(p.id);
        ensureSpace(doc, thumbH + 30);
        const x = doc.page.margins.left + (col === 0 ? 0 : colWidth + 12);
        const y = doc.y;
        if (
          buf &&
          /\.(jpe?g|png)$/i.test(p.filename) &&
          safeImageEmbed(doc, buf, p.filename, {
            fit: [colWidth, thumbH],
            align: "center",
          })
        ) {
          // image moved doc.y; restore for the second column.
        } else {
          doc
            .strokeColor("#e5e7eb")
            .lineWidth(1)
            .rect(x, y, colWidth, thumbH)
            .stroke();
          doc
            .fontSize(9)
            .fillColor("#888")
            .text("(image not embedded)", x, y + thumbH / 2 - 5, {
              width: colWidth,
              align: "center",
            });
        }
        // Caption row
        if (p.caption) {
          doc.y = y + thumbH + 4;
          doc.fontSize(8).fillColor("#444").text(p.caption, x, doc.y, {
            width: colWidth,
            ellipsis: true,
          });
        }
        if (col === 1) {
          doc.y = y + thumbH + 24;
        } else {
          // Reset y so the second column lines up with the first.
          doc.y = y;
        }
        col = col === 0 ? 1 : 0;
      }
      if (col === 1) doc.moveDown(8); // close out the trailing single column
    }
    doc.moveDown(0.4);

    // Reminders ------------------------------------------------------------
    sectionTitle(doc, "Reminders");
    if (reminders.length === 0) {
      emptyNote(doc, "No reminders.");
    } else {
      for (const r of reminders.slice(0, 60)) {
        bullet(
          doc,
          `${fmtDateTime(r.remindAt)} — ${r.title} (${r.user.name})${r.sent ? "  ✓ sent" : ""}`,
        );
      }
      if (reminders.length > 60) {
        doc.fontSize(9).fillColor("#666").text(
          `…older entries omitted (${reminders.length - 60}).`,
        );
      }
    }
    doc.moveDown(0.4);

    // Points ledger per child ---------------------------------------------
    sectionTitle(doc, "Points ledger");
    {
      const children = users.filter((u) => u.role === "CHILD");
      if (children.length === 0) {
        emptyNote(doc, "No children on the account.");
      } else {
        for (const c of children) {
          const rows = points.filter((p) => p.childId === c.id);
          const balance = rows.reduce((acc, r) => acc + r.points, 0);
          subSection(doc, `${c.avatarEmoji}  ${c.name}  —  ${balance} pts`);
          if (rows.length === 0) {
            emptyNote(doc, "No transactions.");
            continue;
          }
          for (const t of rows.slice(0, 60)) {
            const sign = t.points > 0 ? "+" : "";
            bullet(
              doc,
              `${fmtDateTime(t.createdAt)} — ${sign}${t.points} pts · ${t.reason}`,
            );
          }
          if (rows.length > 60) {
            doc.fontSize(9).fillColor("#666").text(
              `…older entries omitted (${rows.length - 60}).`,
            );
          }
          doc.moveDown(0.3);
        }
      }
    }

    // Reward redemptions --------------------------------------------------
    sectionTitle(doc, "Reward redemptions");
    if (rewardRedemptions.length === 0) {
      emptyNote(doc, "No redemptions yet.");
    } else {
      for (const r of rewardRedemptions) {
        const status = r.status.toLowerCase();
        bullet(
          doc,
          `${fmtDateTime(r.createdAt)} — ${r.child.name} redeemed ${r.itemName} (${r.costPoints} pts, ${status})`,
        );
      }
    }
    doc.moveDown(0.4);

    // Reward catalogue ----------------------------------------------------
    sectionTitle(doc, "Reward catalogue");
    if (rewardItems.length === 0) {
      emptyNote(doc, "No rewards in the catalogue.");
    } else {
      for (const it of rewardItems) {
        ensureSpace(doc, 40);
        const buf = rewardBufs.get(it.id);
        if (buf && it.imageFilename && /\.(jpe?g|png)$/i.test(it.imageFilename)) {
          // pdfkit defaults to left alignment when `align` is omitted —
          // and its types only allow "center" | "right" as explicit
          // values, so we leave the option off to get the desired
          // left-flush thumbnail next to the reward name.
          safeImageEmbed(doc, buf, it.imageFilename, {
            fit: [60, 60],
          });
        }
        doc
          .fontSize(11)
          .fillColor("#111")
          .font("Helvetica-Bold")
          .text(`${it.name}  —  ${it.costPoints} pts`);
        doc.font("Helvetica");
        if (it.category) {
          doc.fontSize(9).fillColor("#666").text(`Category: ${it.category.name}`);
        }
        if (it.description) {
          doc.fontSize(10).fillColor("#222").text(it.description);
        }
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(0.4);

    // Maintenance log -----------------------------------------------------
    sectionTitle(doc, "Maintenance log");
    if (maintenanceItems.length === 0) {
      emptyNote(doc, "Nothing tracked.");
    } else {
      for (const m of maintenanceItems) {
        ensureSpace(doc, 60);
        doc
          .fontSize(12)
          .fillColor("#111")
          .font("Helvetica-Bold")
          .text(`${m.name}  (${m.deviceType.toLowerCase()})`);
        doc.font("Helvetica");
        if (m.identifier)
          kv(doc, "Identifier", m.identifier);
        kv(doc, "Service interval", `${m.serviceIntervalMonths} months`);
        if (m.lastServicedAt)
          kv(doc, "Last serviced", fmtDate(m.lastServicedAt));
        if (m.nextServiceDue)
          kv(doc, "Next due", fmtDate(m.nextServiceDue));
        if (m.registrationNumber)
          kv(doc, "Registration", `${m.registrationNumber} (expires ${fmtDate(m.registrationExpiresAt)})`);
        if (m.insuranceProvider)
          kv(doc, "Insurance", `${m.insuranceProvider}${m.insurancePolicyNumber ? ` #${m.insurancePolicyNumber}` : ""} (expires ${fmtDate(m.insuranceExpiresAt)})`);
        if (m.notes) {
          doc.fontSize(10).fillColor("#222").text(m.notes);
        }
        const recs = serviceRecords.filter((r) => r.itemId === m.id);
        if (recs.length > 0) {
          subSection(doc, "Service history");
          for (const r of recs) {
            const cost = r.cost ? `  (${fmtMoney(r.cost as unknown as string)})` : "";
            bullet(
              doc,
              `${fmtDate(r.servicedAt)} — ${r.workDone}${cost}${r.performedBy ? `, ${r.performedBy}` : ""}`,
            );
          }
        }
        doc.moveDown(0.4);
      }
    }
    doc.moveDown(0.4);

    // Tax records ---------------------------------------------------------
    sectionTitle(doc, "Tax records");
    if (taxReceipts.length === 0) {
      emptyNote(doc, "No receipts saved.");
    } else {
      // Group by owning user — tax data is per-user.
      const byOwner = new Map<string, typeof taxReceipts>();
      for (const r of taxReceipts) {
        const arr = byOwner.get(r.ownerId) ?? [];
        arr.push(r);
        byOwner.set(r.ownerId, arr);
      }
      for (const [ownerId, list] of byOwner) {
        const owner = users.find((u) => u.id === ownerId);
        subSection(doc, `${owner?.name ?? "Unknown"}'s receipts`);
        let total = 0;
        for (const r of list) {
          const amt = Number(r.totalAmount);
          total += amt;
          bullet(
            doc,
            `${fmtDate(r.date)} — ${r.vendor} — ${fmtMoney(r.totalAmount as unknown as string)}` +
              (r.lineItems.length > 0
                ? `  (${r.lineItems.length} items)`
                : ""),
          );
        }
        kv(doc, "Total", fmtMoney(total));
        doc.moveDown(0.3);
      }
    }

    // Footer + done -------------------------------------------------------
    doc.moveDown(0.6);
    doc
      .fontSize(8)
      .fillColor("#888")
      .text(
        "End of export. App settings, internal IDs, password hashes and session data are intentionally excluded — this document is for taking your family's life with you, not for restoring an installation. Use the .zip backup for that.",
        {
          width: pageRight(doc) - doc.page.margins.left,
          align: "left",
        },
      );

    doc.end();
  });
}
