import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

// DELETE /api/shopping/done — clear every ticked-off shopping item.
// Called by the "Clear ticked" toolbar button. Returns the row count
// removed so the client can show a small confirmation toast.
//
// v4.7.6 — bulk delete guarded by canEditShopping; outstanding (un-ticked)
// items are left alone so the list still shows what's actually missing
// from the kitchen after a shop.
export async function DELETE() {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const result = await prisma.shoppingItem.deleteMany({
      where: { done: true },
    });
    return NextResponse.json({ removed: result.count });
  } catch (e) {
    return handleError(e);
  }
}
