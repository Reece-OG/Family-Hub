// v4.7.19 — helpers for the new ShoppingMaster reusable-item catalogue.
//
// The "master" is the canonical, family-wide record of an item people buy
// repeatedly (Milk, Bread, Bananas, …). Every time a ShoppingItem row is
// created — manually from the add form, by tapping a catalog entry, by
// adding a recipe's ingredients to the list, or by the weekly menu builder —
// we call upsertMaster so the catalog grows on its own without anyone ever
// having to curate it.
//
// `nameKey` is the lowercased / trimmed / single-spaced form of `name` and
// carries the @unique constraint. This makes "Milk", "milk", " MILK " all
// resolve to the same master row without needing citext on the database.

import { prisma } from "@/lib/prisma";

// Lowercase + collapse internal whitespace + trim. Diacritics intentionally
// kept (so "café" stays a distinct master from "cafe") — families that want
// to merge can do it manually from the catalog editor.
export function normaliseKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface UpsertMasterInput {
  name: string;
  category?: string | null;
  defaultQuantity?: string | null;
  userId?: string | null;
}

// Idempotent upsert: looks for the master by nameKey, creates it if missing,
// otherwise bumps useCount + lastUsedAt and fills blank fields from the input
// (we deliberately DON'T overwrite an existing category — the master keeps
// the first non-blank value it was given so renames stick).
//
// Returns the (created or updated) master. Caller decides whether to surface
// it in the API response; usually we ignore the return value.
export async function upsertMaster(input: UpsertMasterInput) {
  const trimmedName = input.name.trim();
  if (!trimmedName) return null;
  const nameKey = normaliseKey(trimmedName);
  if (!nameKey) return null;

  const existing = await prisma.shoppingMaster.findUnique({
    where: { nameKey },
  });

  const now = new Date();

  if (existing) {
    // Bump usage, lazily fill any field that was blank before. We never
    // overwrite a value that's already set — preserves user intent across
    // the inevitable "Oh, I categorised this wrong, let me fix it" workflow.
    const patch: {
      category?: string;
      defaultQuantity?: string;
      hidden?: boolean;
      useCount?: number;
      lastUsedAt?: Date;
    } = {
      useCount: existing.useCount + 1,
      lastUsedAt: now,
    };
    if (!existing.category && input.category) {
      patch.category = input.category;
    }
    if (!existing.defaultQuantity && input.defaultQuantity) {
      patch.defaultQuantity = input.defaultQuantity;
    }
    // Resurrect hidden masters when someone adds them again — clearly they
    // want this item back in the catalog.
    if (existing.hidden) {
      patch.hidden = false;
    }
    return prisma.shoppingMaster.update({
      where: { id: existing.id },
      data: patch,
    });
  }

  return prisma.shoppingMaster.create({
    data: {
      name: trimmedName,
      nameKey,
      category: input.category || null,
      defaultQuantity: input.defaultQuantity || null,
      useCount: 1,
      lastUsedAt: now,
      createdById: input.userId || null,
    },
  });
}

// Returns the master that exactly matches the (normalised) name, or null. Used
// by the from-recipe route to inherit category onto a new ShoppingItem when
// the recipe's ingredient row didn't specify one.
export async function findMaster(name: string) {
  const nameKey = normaliseKey(name);
  if (!nameKey) return null;
  return prisma.shoppingMaster.findUnique({ where: { nameKey } });
}
