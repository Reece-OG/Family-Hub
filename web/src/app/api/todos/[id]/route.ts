import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { nextOccurrenceAfter, ruleFromRow } from "@/lib/recurrence";

const recurrenceFrequencyEnum = z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  assigneeId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  showOnCalendar: z.boolean().optional(),
  done: z.boolean().optional(),
  recurrenceFrequency: recurrenceFrequencyEnum.nullable().optional(),
  recurrenceInterval: z.number().int().min(1).max(999).nullable().optional(),
  recurrenceByWeekday: z.string().nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional(),
  recurrenceEndCount: z.number().int().min(1).max(999).nullable().optional(),
  // v4.7.7 — parent-set "earn this many points when done". Children can
  // see the value but the API rejects edits from non-parent users below.
  pointsReward: z.number().int().min(0).max(10_000).optional(),
});

const todoInclude = {
  createdBy: { select: { id: true, name: true, color: true, avatarEmoji: true } },
  assignee: { select: { id: true, name: true, color: true, avatarEmoji: true } },
  category: { select: { id: true, name: true, color: true } },
} as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditTodos")) throw new HttpError(403, "No permission");
    const input = patchSchema.parse(await req.json());

    // v4.7.7 — only parents can change a todo's pointsReward. Children
    // marking off a todo aren't allowed to bump their own payout.
    if (input.pointsReward !== undefined && me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can set the points reward");
    }

    const data: Record<string, unknown> = {};
    for (const k of [
      "title",
      "description",
      "priority",
      "assigneeId",
      "categoryId",
      "showOnCalendar",
      "done",
      "recurrenceFrequency",
      "recurrenceInterval",
      "recurrenceByWeekday",
      "recurrenceEndCount",
      "pointsReward",
    ] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    if (input.dueAt !== undefined) {
      data.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    }
    if (input.recurrenceEndDate !== undefined) {
      data.recurrenceEndDate = input.recurrenceEndDate
        ? new Date(input.recurrenceEndDate)
        : null;
    }

    // Load the row once with the fields we need for both rollover + points
    // logic. Includes assignee role so we can decide whether to credit.
    const existing = await prisma.todo.findUnique({
      where: { id: params.id },
      include: { assignee: { select: { id: true, role: true, name: true } } },
    });
    if (!existing) throw new HttpError(404, "To-do not found");

    // ----- recurring rollover (v4.7.5) -----
    let createNextFromRecurring = false;
    let nextDueAt: Date | null = null;
    if (input.done === true) {
      if (existing.recurrenceFrequency && existing.dueAt) {
        const rule = ruleFromRow({
          recurrenceFrequency: existing.recurrenceFrequency,
          recurrenceInterval: existing.recurrenceInterval,
          recurrenceByWeekday: existing.recurrenceByWeekday,
          recurrenceEndDate: existing.recurrenceEndDate,
          recurrenceEndCount: existing.recurrenceEndCount,
        });
        if (rule) {
          if (existing.recurrenceEndCount != null) {
            const remaining = existing.recurrenceEndCount - 1;
            if (remaining >= 1) {
              nextDueAt = nextOccurrenceAfter(rule, existing.dueAt);
              createNextFromRecurring = nextDueAt !== null;
              if (createNextFromRecurring) {
                rule.endCount = remaining;
              }
            }
          } else {
            nextDueAt = nextOccurrenceAfter(rule, existing.dueAt);
            createNextFromRecurring = nextDueAt !== null;
          }
        }
      }
    }

    // ----- points award (v4.7.7) -----
    // We award when:
    //   • done is being flipped from false → true on this PATCH,
    //   • the row has pointsReward > 0,
    //   • the row hasn't been awarded before (pointsAwardedTransactionId null),
    //   • the assignee exists and is a CHILD.
    // The actor (`awardedById`) is whoever fired this PATCH — usually the
    // child themselves ticking the checkbox, sometimes a parent doing it
    // on their behalf. Either way the credit goes to the child via
    // PointsTransaction.childId = assignee.
    const flippingDone =
      input.done === true && existing.done === false;
    const shouldAward =
      flippingDone &&
      (existing.pointsReward ?? 0) > 0 &&
      existing.pointsAwardedTransactionId == null &&
      existing.assignee?.role === "CHILD";

    const todo = await prisma.$transaction(async (tx) => {
      const updated = await tx.todo.update({
        where: { id: params.id },
        data,
        include: todoInclude,
      });

      // Award points first so the rollover row never accidentally gets
      // its pointsAwardedTransactionId pre-set.
      if (shouldAward && existing.assignee) {
        const txn = await tx.pointsTransaction.create({
          data: {
            childId: existing.assignee.id,
            awardedById: me.id,
            points: existing.pointsReward ?? 0,
            reason: `To-do: ${existing.title}`,
          },
        });
        await tx.todo.update({
          where: { id: params.id },
          data: { pointsAwardedTransactionId: txn.id },
        });
      }

      if (createNextFromRecurring && nextDueAt) {
        const parent = await tx.todo.findUnique({ where: { id: params.id } });
        if (parent) {
          await tx.todo.create({
            data: {
              title: parent.title,
              description: parent.description,
              dueAt: nextDueAt,
              priority: parent.priority,
              createdById: parent.createdById,
              assigneeId: parent.assigneeId,
              categoryId: parent.categoryId,
              showOnCalendar: parent.showOnCalendar,
              done: false,
              recurrenceFrequency: parent.recurrenceFrequency,
              recurrenceInterval: parent.recurrenceInterval,
              recurrenceByWeekday: parent.recurrenceByWeekday,
              recurrenceEndDate: parent.recurrenceEndDate,
              recurrenceEndCount:
                parent.recurrenceEndCount != null
                  ? parent.recurrenceEndCount - 1
                  : null,
              // Carry the same points value forward so each instance pays.
              pointsReward: parent.pointsReward,
              // The fresh row hasn't been awarded yet.
              pointsAwardedTransactionId: null,
            },
          });
          // Strip recurrence from the just-completed row so the chain only
          // exists on the active instance.
          await tx.todo.update({
            where: { id: params.id },
            data: {
              recurrenceFrequency: null,
              recurrenceInterval: null,
              recurrenceByWeekday: null,
              recurrenceEndDate: null,
              recurrenceEndCount: null,
            },
          });
        }
      }

      return updated;
    });

    // v4.9.0 — fire todo.completed when this PATCH flipped done from
    // false → true. Outside the transaction so a stuck webhook can't
    // hold the DB row locked. Fire-and-forget per the bus contract.
    if (flippingDone) {
      try {
        const { dispatchEvent } = await import("@/lib/webhooks");
        dispatchEvent("todo.completed", {
          id: todo.id,
          title: todo.title,
          description: todo.description,
          due_at: todo.dueAt?.toISOString() ?? null,
          completed_at: new Date().toISOString(),
          completed_by_id: me.id,
          assignee_id: todo.assigneeId,
          category_id: todo.categoryId,
          points_reward: todo.pointsReward,
          // Whether this completion atomically credited the assignee. Lets
          // HA distinguish "kid did chores → awarded" from a parent retro-
          // ticking an old todo that no longer pays out.
          points_awarded: shouldAward,
        });
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({ todo });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditTodos")) throw new HttpError(403, "No permission");
    await prisma.todo.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
