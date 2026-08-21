import { prisma } from "./prisma";

// First-load seed for the rewards catalogue. Bundled categories are marked
// isStarter=true so the UI can show a 'Starter' chip until a parent
// renames or deletes them. Seed only runs when the family has zero
// RewardCategory rows so a deliberately-emptied list isn't auto-resurrected.

const STARTER_CATEGORIES: { name: string; hint: string }[] = [
  { name: "Cash", hint: "Pocket-money equivalents (e.g. $1, $5)" },
  { name: "Sweets", hint: "Treats, lollies, ice cream" },
  { name: "Screen time", hint: "Extra TV / tablet / game minutes" },
  { name: "Privileges", hint: "Stay-up-late, choose-the-movie, etc." },
  { name: "Other", hint: "Catch-all for anything else" },
];

export async function ensureStarterRewardCategories(creatorId: string): Promise<void> {
  const count = await prisma.rewardCategory.count();
  if (count > 0) return;
  // createMany for speed — unique constraint is on `name` only, so collisions
  // can't happen on a fresh seed. Position carries the bundled order.
  await prisma.rewardCategory.createMany({
    data: STARTER_CATEGORIES.map((c, i) => ({
      name: c.name,
      hint: c.hint,
      position: i,
      isStarter: true,
      createdById: creatorId,
    })),
    skipDuplicates: true,
  });
}
