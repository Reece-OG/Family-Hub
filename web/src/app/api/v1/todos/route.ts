// v4.9.0 — public REST: GET /api/v1/todos
//
// Returns todos. By default only open (done=false) todos are returned;
// pass ?include_done=1 to include completed ones too.
//   ?assignee_id=<uid>    filter to a single assignee
//   ?category_id=<cid>    filter to a single category
//   ?limit=<n>            cap 500, default 200
//
// Authn via Authorization: Bearer <token> with scope "todos:read".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiToken } from "@/lib/api-auth";
import { handleError } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    await requireApiToken(req, "todos:read");

    const url = new URL(req.url);
    const includeDone = url.searchParams.get("include_done") === "1";
    const assigneeId = url.searchParams.get("assignee_id");
    const categoryId = url.searchParams.get("category_id");
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(500, Math.floor(limitParam))
        : 200;

    const where: {
      done?: boolean;
      assigneeId?: string;
      categoryId?: string;
    } = {};
    if (!includeDone) where.done = false;
    if (assigneeId) where.assigneeId = assigneeId;
    if (categoryId) where.categoryId = categoryId;

    const rows = await prisma.todo.findMany({
      where,
      take: limit,
      orderBy: [
        { done: "asc" },
        { priority: "desc" },
        { dueAt: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        assignee: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      count: rows.length,
      todos: rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        done: t.done,
        due_at: t.dueAt?.toISOString() ?? null,
        priority: t.priority,
        created_by_id: t.createdById,
        assignee_id: t.assigneeId,
        assignee_name: t.assignee?.name ?? null,
        category_id: t.categoryId,
        category_name: t.category?.name ?? null,
        show_on_calendar: t.showOnCalendar,
        recurring: Boolean(t.recurrenceFrequency),
        points_reward: t.pointsReward,
        created_at: t.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
