// Bootstrap seed: creates a parent user only if no users exist.
// Run automatically by docker-entrypoint.sh on container start.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const prisma = new PrismaClient();
  try {
    // Ensure singleton AppSettings row exists.
    await prisma.appSettings.upsert({
      where: { id: "singleton" },
      update: {},
      create: {
        id: "singleton",
        countryCode: process.env.SEED_COUNTRY_CODE || "GB",
        timezone: process.env.SEED_TIMEZONE || "Europe/London",
        showHolidays: true,
      },
    });

    const count = await prisma.user.count();
    if (count > 0) {
      console.log(`[seed] ${count} user(s) already present — skipping user seed.`);
      return;
    }

    const email = process.env.SEED_PARENT_EMAIL || "parent@example.com";
    const password = process.env.SEED_PARENT_PASSWORD || "changeme";
    const name = process.env.SEED_PARENT_NAME || "Parent";

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        role: "PARENT",
        color: "#7c3aed",
        avatarEmoji: "👑",
        // Bootstrap account — the (app) layout redirects any user with this
        // flag to /setup so they can replace the well-known default creds.
        // Cleared by POST /api/auth/setup once they save new details.
        mustChangeCredentials: true,
        permissions: {
          create: {
            canViewCalendar: true,
            canEditCalendar: true,
            canViewTodos: true,
            canEditTodos: true,
            canViewShopping: true,
            canEditShopping: true,
            canManageUsers: true,
            canViewMenu: true,
            canEditMenu: true,
            canViewRecipes: true,
            canEditRecipes: true,
            canViewRewards: true,
            canManageRewards: true,
            canViewPhotos: true,
            canManagePhotos: true,
            canViewReminders: true,
            canEditReminders: true,
            canViewMaintenance: true,
            canManageMaintenance: true,
          },
        },
      },
    });
    console.log(`[seed] Created bootstrap parent: ${user.email}`);
  } catch (err) {
    console.error("[seed] Error:", err.message);
    process.exitCode = 0; // non-fatal
  } finally {
    await prisma.$disconnect();
  }
}

main();
