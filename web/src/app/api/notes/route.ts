// v4.9.2 — family sticky-notes CRUD.
//
// GET  /api/notes  — list everything (pinned first, then newest).
// POST /api/notes  — create. Author = current user.
//
// Anyone signed in (children included) can post a note. Editing and
// deleting are gated to the author OR any parent — see the [id] route.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

// Small palette. The UI may add more strings here later; the API
// normalises unknown values to "yellow" rather than 400ing so a future
// client that ships a colour ahead of the server doesn't break.
const ALLOWED_COLOURS = ["yellow", "pink", "green", "blue"] as const;
type Colour = (typeof ALLOWED_COLOURS)[number];
function normaliseColour(raw: unknown): Colour {
  return typeof raw === "string" && (ALLOWED_COLOURS as readonly string[]).includes(raw)
    ? (raw as Colour)
    : "yellow";
}

const createSchema = z.object({
  body: z.string().trim().min(1).max(500),
  color: z.string().optional(),
  pinned: z.boolean().optional(),
});

function serialise(n: {
  id: string;
  body: string;
  color: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; name: string; color: string; avatarEmoji: string };
}) {
  return {
    id: n.id,
    body: n.body,
    color: n.color,
    pinned: n.pinned,
    created_at: n.createdAt.toISOString(),
    updated_at: n.updatedAt.toISOString(),
    author: {
      id: n.author.id,
      name: n.author.name,
      color: n.author.color,
      avatar_emoji: n.author.avatarEmoji,
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(200, Math.floor(limitParam))
        : 100;

    const notes = await prisma.stickyNote.findMany({
      take: limit,
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      include: {
        author: {
          select: { id: true, name: true, color: true, avatarEmoji: true },
        },
      },
    });
    return NextResponse.json({ notes: notes.map(serialise) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const input = createSchema.parse(await req.json());
    const note = await prisma.stickyNote.create({
      data: {
        body: input.body,
        color: normaliseColour(input.color),
        pinned: input.pinned ?? false,
        authorId: me.id,
      },
      include: {
        author: {
          select: { id: true, name: true, color: true, avatarEmoji: true },
        },
      },
    });
    return NextResponse.json({ note: serialise(note) });
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
