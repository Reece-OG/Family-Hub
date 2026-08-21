import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const recurrenceFrequencyEnum = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  dueAt: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(3).optional(),
  assigneeId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  showOnCalendar: z.boolean().optional(),
  recurrenceFrequency: recurrenceFrequencyEnum.optional().nullable(),
  recurrenceInterval: z.number().int().min(1).max(999).optional().nullable(),
  recurrenceByWeekday: z.string().optional().nullable(),
  recurrenceEndDate: z.string().optional().nullable(),
  recurrenceEndCount: z.number().int().min(1).max(999).optional().nullable(),
  // v4.7.7 — points awarded when this todo is marked done by a child
  // assignee. Parent-only field; non-parents creating todos with this set
  // are rejected below.
  pointsReward: z.number().int().min(0).max(10_000).optional(),
});

const todoInclude = {
  createdBy: { select: { id: true, name: true, color: true, avatarEmoji: true } },
  assignee: { select: { id: true, name: true, color: true, avatarEmoji: true } },
  category: { select: { id: true, name: true, color: true } },
} as const;

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewTodos")) throw new HttpError(403, "No permission");
    const todos = await prisma.todo.findMany({
      include: todoInclude,
      orderBy: [{ done: "asc" }, { priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ todos });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditTodos")) throw new HttpError(403, "No permission");
    const input = createSchema.parse(await req.json());
    if ((input.pointsReward ?? 0) > 0 && me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can set the points reward");
    }
    const todo = await prisma.todo.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        priority: input.priority ?? 0,
        createdById: me.id,
        assigneeId: input.assigneeId ?? null,
        categoryId: input.categoryId ?? null,
        showOnCalendar: input.showOnCalendar ?? false,
        recurrenceFrequency: input.recurrenceFrequency ?? null,
        recurrenceInterval: input.recurrenceInterval ?? null,
        recurrenceByWeekday: input.recurrenceByWeekday ?? null,
        recurrenceEndDate: input.recurrenceEndDate
          ? new Date(input.recurrenceEndDate)
          : null,
        recurrenceEndCount: input.recurrenceEndCount ?? null,
        pointsReward: input.pointsReward ?? 0,
      },
      include: todoInclude,
    });

    // v4.9.0 — public webhook bus. Fire-and-forget so a misbehaving HA
    // subscriber can't wedge the todo POST. Dynamically imported so the
    // Edge bundle never has to resolve crypto / fetch internals.
    try {
      const { dispatchEvent } = await import("@/lib/webhooks");
      dispatchEvent("todo.created", {
        id: todo.id,
        title: todo.title,
        description: todo.description,
        done: todo.done,
        due_at: todo.dueAt?.toISOString() ?? null,
        priority: todo.priority,
        created_by_id: todo.createdById,
        assignee_id: todo.assigneeId,
        category_id: todo.categoryId,
        points_reward: todo.pointsReward,
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ todo });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
