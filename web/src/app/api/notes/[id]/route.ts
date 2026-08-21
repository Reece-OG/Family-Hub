// v4.9.2 — single sticky note: edit / pin / delete.
//
// Access: author OR any parent. We re-fetch the row before the update so
// we can do the authorisation check after we know who wrote it.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

const ALLOWED_COLOURS = ["yellow", "pink", "green", "blue"] as const;
type Colour = (typeof ALLOWED_COLOURS)[number];
function normaliseColour(raw: unknown): Colour {
  return typeof raw === "string" && (ALLOWED_COLOURS as readonly string[]).includes(raw)
    ? (raw as Colour)
    : "yellow";
}

const patchSchema = z.object({
  body: z.string().trim().min(1).max(500).optional(),
  color: z.string().optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    const existing = await prisma.stickyNote.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    if (existing.authorId !== me.id && me.role !== "PARENT") {
      throw new HttpError(403, "Only the author or a parent can edit this note");
    }

    const input = patchSchema.parse(await req.json());
    const data: { body?: string; color?: string; pinned?: boolean } = {};
    if (input.body !== undefined) data.body = input.body;
    if (input.color !== undefined) data.color = normaliseColour(input.color);
    if (input.pinned !== undefined) data.pinned = input.pinned;

    const updated = await prisma.stickyNote.update({
      where: { id: params.id },
      data,
      include: {
        author: {
          select: { id: true, name: true, color: true, avatarEmoji: true },
        },
      },
    });
    return NextResponse.json({
      note: {
        id: updated.id,
        body: updated.body,
        color: updated.color,
        pinned: updated.pinned,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
        author: {
          id: updated.author.id,
          name: updated.author.name,
          color: updated.author.color,
          avatar_emoji: updated.author.avatarEmoji,
        },
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    const existing = await prisma.stickyNote.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    if (existing.authorId !== me.id && me.role !== "PARENT") {
      throw new HttpError(
        403,
        "Only the author or a parent can delete this note",
      );
    }
    await prisma.stickyNote.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
