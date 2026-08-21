import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { ensureStarterCategories } from "@/lib/taxes";

// GET /api/taxes/categories
// Returns the caller's categories (seeding the ATO starter list on first
// access). Rejected on kiosk sessions by requirePrivateUser.
export async function GET() {
  try {
    const me = await requirePrivateUser();
    await ensureStarterCategories(me.id);
    const categories = await prisma.taxCategory.findMany({
      where: { ownerId: me.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ categories });
  } catch (e) {
    return handleError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  hint: z.string().max(280).optional().nullable(),
});

// POST /api/taxes/categories — creates a new user-owned category. The
// (ownerId, name) unique on the schema means renames-to-collide error out
// cleanly with a 409.
export async function POST(req: NextRequest) {
  try {
    const me = await requirePrivateUser();
    const input = createSchema.parse(await req.json());
    const max = await prisma.taxCategory.aggregate({
      where: { ownerId: me.id },
      _max: { position: true },
    });
    const category = await prisma.taxCategory.create({
      data: {
        ownerId: me.id,
        name: input.name.trim(),
        hint: input.hint?.trim() || null,
        position: (max._max.position ?? -1) + 1,
        isStarter: false,
      },
    });
    return NextResponse.json({ category });
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    return handleError(e);
  }
}
