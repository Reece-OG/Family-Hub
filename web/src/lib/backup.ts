// =============================================================================
//  Family Hub — Backup & Restore (v4.7.8)
// =============================================================================
//
//  collectBackup() walks every family-data table + every uploaded file and
//  packs them into a single ZIP. The archive contains:
//    manifest.json        - schema version, exporter, record counts
//    data.json            - one JSON property per Prisma model
//    uploads/<sub>/<file> - every file from each upload subdirectory
//
//  restoreBackup() does the inverse: validates the manifest, wipes the
//  database in REVERSE-dependency order, then re-inserts in DEPENDENCY
//  order so foreign keys are always satisfied. Settings are upserted on
//  the singleton row first so the rest of the app comes up sane while the
//  data is still loading. Uploads are wiped and re-extracted last.
//
//  Two implementation notes:
//
//   1. Decimals + dates round-trip through JSON as strings. Prisma's
//      create() accepts both — strings are coerced to the underlying
//      Decimal/DateTime type — so we don't need any custom parsing.
//
//   2. We use ONE big Prisma transaction for the wipe and ANOTHER for the
//      restore inserts (rather than a single combined transaction) so
//      Postgres doesn't have to hold a write lock for the full duration.
//      File operations happen outside the transactions because Prisma's
//      tx scope is database-only.

import path from "node:path";
import { promises as fs } from "node:fs";
import AdmZip from "adm-zip";
import { prisma } from "./prisma";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads");

// Every subdirectory the app may write into. Listed explicitly so the
// restore can wipe + recreate exactly the right tree without relying on
// fs.readdir of UPLOADS_DIR (which might contain unrelated files on a
// shared host).
const UPLOAD_SUBDIRS = [
  "photos",
  "recipe-images",
  "receipts",
  "reward-images",
  "maintenance-docs",
];

// Bumped whenever the on-disk format changes (new model, removed model,
// breaking schema rename). Restore checks the major + minor of the
// stored vs current and refuses to import across breaking versions.
export const BACKUP_SCHEMA_VERSION = "4.7";

export type BackupManifest = {
  schemaVersion: string;
  appVersion: string;
  exportedAt: string;
  exportedById: string;
  exportedByName: string;
  recordCounts: Record<string, number>;
};

// -----------------------------------------------------------------------------
//  Export
// -----------------------------------------------------------------------------

export async function collectBackup(args: {
  actorId: string;
  actorName: string;
  appVersion: string;
}): Promise<Buffer> {
  // Pull each model in DEPENDENCY-ORDER so the JSON inside the zip is
  // already topologically sorted. Restore could re-sort, but ordering at
  // export time means the JSON is also human-readable in the obvious way.
  const data = {
    appSettings: await prisma.appSettings.findMany(),
    users: await prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    userPermissions: await prisma.userPermissions.findMany(),
    holidays: await prisma.holiday.findMany(),
    todoCategories: await prisma.todoCategory.findMany(),
    rewardCategories: await prisma.rewardCategory.findMany(),
    taxCategories: await prisma.taxCategory.findMany(),
    rewardItems: await prisma.rewardItem.findMany(),
    events: await prisma.event.findMany(),
    eventParticipants: await prisma.eventParticipant.findMany(),
    eventReminders: await prisma.eventReminder.findMany(),
    birthdays: await prisma.birthday.findMany(),
    recipes: await prisma.recipe.findMany(),
    recipeIngredients: await prisma.recipeIngredient.findMany(),
    menuEntries: await prisma.menuEntry.findMany(),
    photos: await prisma.photo.findMany(),
    maintenanceItems: await prisma.maintenanceItem.findMany(),
    serviceRecords: await prisma.serviceRecord.findMany(),
    taxReceipts: await prisma.taxReceipt.findMany(),
    taxLineItems: await prisma.taxLineItem.findMany(),
    shoppingItems: await prisma.shoppingItem.findMany(),
    // v4.7.19 — reusable shopping catalogue. Backed up so a restore preserves
    // the family's "we usually buy these" list and the useCount/lastUsedAt
    // history that powers the "Recently used" sort.
    shoppingMasters: await prisma.shoppingMaster.findMany(),
    // v4.9.2 — family sticky-notes board. Backed up so the "fridge magnets"
    // survive a restore. Notes Cascade-delete with their author, which the
    // restore order respects (users first, then notes).
    stickyNotes: await prisma.stickyNote.findMany(),
    reminders: await prisma.reminder.findMany(),
    pointsTransactions: await prisma.pointsTransaction.findMany(),
    rewardRedemptions: await prisma.rewardRedemption.findMany(),
    localDevices: await prisma.localDevice.findMany(),
    todos: await prisma.todo.findMany(),
    // v4.7.9 — push enrolments. Restoring to the same host keeps push
    // working without re-enrolling every device; restoring to a new host
    // will see all of these stale at first send and prune them.
    pushSubscriptions: await prisma.pushSubscription.findMany(),
  };

  const recordCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    recordCounts[k] = Array.isArray(v) ? v.length : 1;
  }

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: args.appVersion,
    exportedAt: new Date().toISOString(),
    exportedById: args.actorId,
    exportedByName: args.actorName,
    recordCounts,
  };

  const zip = new AdmZip();
  zip.addFile(
    "manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
  );
  zip.addFile(
    "data.json",
    Buffer.from(JSON.stringify(data, null, 2), "utf-8"),
  );

  // Pack every file under each upload subdir, namespaced by the subdir so
  // restore knows exactly where to write each entry back to.
  for (const sub of UPLOAD_SUBDIRS) {
    const dir = path.join(UPLOADS_DIR, sub);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
        // Subdir might not exist yet on a brand-new install; skip.
        continue;
      }
      throw err;
    }
    for (const filename of entries) {
      const abs = path.join(dir, filename);
      // Defensive: skip subdirectories — we only ship leaf files.
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      const buf = await fs.readFile(abs);
      zip.addFile(`uploads/${sub}/${filename}`, buf);
    }
  }

  return zip.toBuffer();
}

// -----------------------------------------------------------------------------
//  Restore
// -----------------------------------------------------------------------------

type RestoreData = Record<string, unknown[] | undefined> & {
  appSettings?: Record<string, unknown>[];
};

function isCompatibleSchemaVersion(version: string): boolean {
  // Accept any backup whose major.minor matches the app's current schema
  // version. Patch-level differences (4.7.7 vs 4.7.8) are fine because we
  // bump SCHEMA_VERSION only when the on-disk shape actually changes.
  const [a, b] = (version || "").split(".");
  const [x, y] = BACKUP_SCHEMA_VERSION.split(".");
  return a === x && b === y;
}

export async function restoreBackup(buf: Buffer): Promise<{
  manifest: BackupManifest;
  inserted: Record<string, number>;
}> {
  // ----- 1. Parse + validate the archive -----
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new Error("Not a valid zip file");
  }

  const manifestEntry = zip.getEntry("manifest.json");
  if (!manifestEntry) {
    throw new Error("Backup is missing manifest.json");
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  if (!manifest.schemaVersion || !isCompatibleSchemaVersion(manifest.schemaVersion)) {
    throw new Error(
      `Backup schema ${manifest.schemaVersion} is incompatible with this app (expected ${BACKUP_SCHEMA_VERSION}.x)`,
    );
  }

  const dataEntry = zip.getEntry("data.json");
  if (!dataEntry) {
    throw new Error("Backup is missing data.json");
  }
  let data: RestoreData;
  try {
    data = JSON.parse(dataEntry.getData().toString("utf-8"));
  } catch {
    throw new Error("data.json is not valid JSON");
  }

  // ----- 2. Wipe the database (reverse-dependency order) -----
  //
  // We could rely on Prisma's onDelete: Cascade for chains rooted at User,
  // but several relations use Restrict / SetNull (LocalDevice.actAsUser,
  // TodoCategory.todos, etc.) so an explicit reverse-topological wipe is
  // safer and easier to audit. AppSettings keeps its singleton row — we
  // upsert it on the way back in.
  await prisma.$transaction(
    async (tx) => {
      // v4.7.9 — delete push subscriptions before users (cascades, but be
      // explicit for symmetry with the other tables).
      await tx.pushSubscription.deleteMany({});
      await tx.rewardRedemption.deleteMany({});
      await tx.rewardItem.deleteMany({});
      await tx.rewardCategory.deleteMany({});
      await tx.taxLineItem.deleteMany({});
      await tx.taxReceipt.deleteMany({});
      await tx.taxCategory.deleteMany({});
      await tx.serviceRecord.deleteMany({});
      await tx.maintenanceItem.deleteMany({});
      await tx.photo.deleteMany({});
      await tx.menuEntry.deleteMany({});
      await tx.recipeIngredient.deleteMany({});
      await tx.recipe.deleteMany({});
      await tx.reminder.deleteMany({});
      await tx.shoppingItem.deleteMany({});
      // v4.7.19 — wipe masters before users so the createdBy FK doesn't fight
      // us when the user table is repopulated below.
      await tx.shoppingMaster.deleteMany({});
      // v4.9.2 — same reason for sticky notes: their authorId FK Cascade-
      // deletes from users, so wiping notes first keeps the user truncation
      // path uneventful.
      await tx.stickyNote.deleteMany({});
      await tx.pointsTransaction.deleteMany({});
      await tx.todo.deleteMany({});
      await tx.todoCategory.deleteMany({});
      await tx.eventReminder.deleteMany({});
      await tx.eventParticipant.deleteMany({});
      await tx.birthday.deleteMany({});
      await tx.event.deleteMany({});
      await tx.localDevice.deleteMany({});
      await tx.userPermissions.deleteMany({});
      await tx.user.deleteMany({});
      await tx.holiday.deleteMany({});
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  // ----- 3. Restore rows (forward-dependency order) -----
  const inserted: Record<string, number> = {};
  const safeArray = <T>(value: unknown): T[] =>
    Array.isArray(value) ? (value as T[]) : [];

  await prisma.$transaction(
    async (tx) => {
      // 3a. AppSettings — upsert so the singleton row always exists.
      const appSettingsRows = safeArray<Record<string, unknown>>(data.appSettings);
      if (appSettingsRows.length > 0) {
        const row = { ...appSettingsRows[0], id: "singleton" };
        await tx.appSettings.upsert({
          where: { id: "singleton" },
          update: row,
          create: row,
        });
        inserted.appSettings = 1;
      }

      // Helper: bulk createMany when supported, otherwise loop. createMany
      // can't include relation fields, but our exported rows are
      // FK-flat, so it's fine.
      async function bulk(
        name: keyof RestoreData,
        run: (rows: Record<string, unknown>[]) => Promise<void>,
      ) {
        const rows = safeArray<Record<string, unknown>>(data[name]);
        if (rows.length === 0) {
          inserted[name as string] = 0;
          return;
        }
        await run(rows);
        inserted[name as string] = rows.length;
      }

      // 3b. Users
      //
      // v4.7.15 — the new User.linkedBirthdayEventId column points at an
      // Event that hasn't been restored yet (events come in at step 3e), so
      // creating the user with the FK populated would blow up with a
      // foreign-key violation. We strip it here and patch it back in step
      // 3e-bis below once the events table is populated.
      const deferredUserBirthdayLinks = new Map<string, string>();
      await bulk("users", async (rows) => {
        for (const u of rows) {
          const row = u as Record<string, unknown>;
          if (typeof row.linkedBirthdayEventId === "string") {
            deferredUserBirthdayLinks.set(
              row.id as string,
              row.linkedBirthdayEventId,
            );
            row.linkedBirthdayEventId = null;
          }
          await tx.user.create({ data: row as never });
        }
      });

      // 3c. Per-user 1:1 + leaf-level user-owned categories first, so
      // every later content row already has its FK target.
      await bulk("userPermissions", async (rows) => {
        for (const r of rows) await tx.userPermissions.create({ data: r as never });
      });
      await bulk("holidays", async (rows) => {
        for (const r of rows) await tx.holiday.create({ data: r as never });
      });
      await bulk("todoCategories", async (rows) => {
        for (const r of rows) await tx.todoCategory.create({ data: r as never });
      });
      await bulk("rewardCategories", async (rows) => {
        for (const r of rows) await tx.rewardCategory.create({ data: r as never });
      });
      await bulk("taxCategories", async (rows) => {
        for (const r of rows) await tx.taxCategory.create({ data: r as never });
      });

      // 3d. Mid-tier — depends on the above
      await bulk("rewardItems", async (rows) => {
        for (const r of rows) await tx.rewardItem.create({ data: r as never });
      });
      await bulk("recipes", async (rows) => {
        for (const r of rows) await tx.recipe.create({ data: r as never });
      });
      await bulk("recipeIngredients", async (rows) => {
        for (const r of rows) await tx.recipeIngredient.create({ data: r as never });
      });
      await bulk("maintenanceItems", async (rows) => {
        for (const r of rows) await tx.maintenanceItem.create({ data: r as never });
      });
      await bulk("serviceRecords", async (rows) => {
        for (const r of rows) await tx.serviceRecord.create({ data: r as never });
      });
      await bulk("taxReceipts", async (rows) => {
        for (const r of rows) await tx.taxReceipt.create({ data: r as never });
      });
      await bulk("taxLineItems", async (rows) => {
        for (const r of rows) await tx.taxLineItem.create({ data: r as never });
      });

      // 3e. Events go in BEFORE Birthday so Birthday.linkedEventId
      // resolves. EventParticipant + EventReminder hang off Event.
      await bulk("events", async (rows) => {
        for (const r of rows) await tx.event.create({ data: r as never });
      });
      await bulk("eventParticipants", async (rows) => {
        for (const r of rows) await tx.eventParticipant.create({ data: r as never });
      });
      await bulk("eventReminders", async (rows) => {
        for (const r of rows) await tx.eventReminder.create({ data: r as never });
      });
      await bulk("birthdays", async (rows) => {
        for (const r of rows) await tx.birthday.create({ data: r as never });
      });

      // 3e-bis (v4.7.15) — patch the deferred User.linkedBirthdayEventId
      // links now that the events table is populated. Best-effort: if the
      // target event is missing for any reason we just skip the link rather
      // than fail the entire restore.
      for (const [userId, eventId] of deferredUserBirthdayLinks) {
        try {
          await tx.user.update({
            where: { id: userId },
            data: { linkedBirthdayEventId: eventId },
          });
        } catch {
          // event missing or already linked — leave the field null
        }
      }

      await bulk("menuEntries", async (rows) => {
        for (const r of rows) await tx.menuEntry.create({ data: r as never });
      });
      await bulk("photos", async (rows) => {
        for (const r of rows) await tx.photo.create({ data: r as never });
      });
      await bulk("shoppingItems", async (rows) => {
        for (const r of rows) await tx.shoppingItem.create({ data: r as never });
      });
      // v4.7.19 — masters arrive after users have been restored, so the
      // createdById FK resolves cleanly. New-schema backups will include the
      // shoppingMasters bucket; older backups simply skip it.
      await bulk("shoppingMasters", async (rows) => {
        for (const r of rows) await tx.shoppingMaster.create({ data: r as never });
      });
      // v4.9.2 — sticky notes also come after users so the authorId FK
      // resolves. Older backups without this bucket simply skip the bulk
      // helper and the board comes up empty.
      await bulk("stickyNotes", async (rows) => {
        for (const r of rows) await tx.stickyNote.create({ data: r as never });
      });
      await bulk("reminders", async (rows) => {
        for (const r of rows) await tx.reminder.create({ data: r as never });
      });
      await bulk("pointsTransactions", async (rows) => {
        for (const r of rows) await tx.pointsTransaction.create({ data: r as never });
      });
      await bulk("rewardRedemptions", async (rows) => {
        for (const r of rows) await tx.rewardRedemption.create({ data: r as never });
      });
      await bulk("localDevices", async (rows) => {
        for (const r of rows) await tx.localDevice.create({ data: r as never });
      });
      await bulk("todos", async (rows) => {
        for (const r of rows) await tx.todo.create({ data: r as never });
      });
      await bulk("pushSubscriptions", async (rows) => {
        for (const r of rows) await tx.pushSubscription.create({ data: r as never });
      });
    },
    { timeout: 180_000, maxWait: 30_000 },
  );

  // ----- 4. Wipe + restore upload files -----
  for (const sub of UPLOAD_SUBDIRS) {
    const dir = path.join(UPLOADS_DIR, sub);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("uploads/")) continue;
    const rel = entry.entryName.replace(/^uploads\//, "");
    // Reject path-traversal attempts; rel must not contain ..
    if (rel.includes("..")) continue;
    const dest = path.join(UPLOADS_DIR, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, entry.getData());
  }

  return { manifest, inserted };
}
