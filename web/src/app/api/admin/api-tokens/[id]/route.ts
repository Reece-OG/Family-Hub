// v4.9.0 — single ApiToken: rename, enable/disable, revoke (delete).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireParent();
    const input = patchSchema.parse(await req.json());
    const data: { name?: string; enabled?: boolean } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    const row = await prisma.apiToken.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json({
      id: row.id,
      name: row.name,
      token_prefix: row.token.slice(0, 8) + "…",
      enabled: row.enabled,
      last_used_at: row.lastUsedAt?.toISOString() ?? null,
      expires_at: row.expiresAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
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
    await requireParent();
    await prisma.apiToken.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
