import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

// DELETE /api/todos/done — clear every completed to-do.
//
// v4.7.15 — mirrors the shopping-list "Clear ticked" pattern (v4.7.6) so
// ticking a to-do leaves it on the list with a strikethrough until the user
// explicitly batches them off. Outstanding (un-ticked) rows are left alone.
//
// Recurring to-dos: the rollover that creates the *next* occurrence runs at
// the moment a parent ticks the recurring to-do done (see PATCH /api/todos/
// [id]), so deleting the historical "done" row here is harmless — the next
// occurrence is already its own un-done row.
export async function DELETE() {
  try {
    const me = await requireUser();
    if (!can(me, "canEditTodos")) throw new HttpError(403, "No permission");
    const result = await prisma.todo.deleteMany({
      where: { done: true },
    });
    return NextResponse.json({ removed: result.count });
  } catch (e) {
    return handleError(e);
  }
}
