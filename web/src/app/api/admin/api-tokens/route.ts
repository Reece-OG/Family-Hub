// v4.9.0 — parent-only CRUD for the public API tokens.
//
// GET  /api/admin/api-tokens             — list (token string is REDACTED;
//                                          only the prefix is returned).
// POST /api/admin/api-tokens             — create. The full token string
//                                          is returned EXACTLY ONCE in
//                                          this response and never again.
//                                          Frontend tells the user to
//                                          copy it now.
//
// Per-token revoke / rename lives at /api/admin/api-tokens/[id].

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { ALL_SCOPES, mintTokenString, parseScopes, type Scope } from "@/lib/api-auth";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().nullable().optional(),
});

// What we serialise back to the UI. We DO NOT return the token string on
// list — only the leading 8 chars so the operator can disambiguate at a
// glance ("which one starts with fhk_a1b2…?"). The full string is only
// shown at creation time, exactly like GitHub PATs.
function serialise(t: {
  id: string;
  name: string;
  token: string;
  scopes: unknown;
  enabled: boolean;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: t.id,
    name: t.name,
    token_prefix: t.token.slice(0, 8) + "…",
    scopes: parseScopes(t.scopes),
    enabled: t.enabled,
    last_used_at: t.lastUsedAt?.toISOString() ?? null,
    expires_at: t.expiresAt?.toISOString() ?? null,
    created_at: t.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    await requireParent();
    const rows = await prisma.apiToken.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ tokens: rows.map(serialise) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireParent();
    const input = createSchema.parse(await req.json());

    // Filter to known scopes server-side. If the request had no valid
    // scopes, reject — a scope-less token is useless and just confuses
    // the operator into thinking it's a "read-only" token.
    const knownScopes = new Set<string>(ALL_SCOPES);
    const scopes: Scope[] = input.scopes.filter(
      (s): s is Scope => knownScopes.has(s),
    );
    if (scopes.length === 0) {
      return NextResponse.json(
        { error: "At least one valid scope is required" },
        { status: 400 },
      );
    }

    let expiresAt: Date | null = null;
    if (input.expiresAt) {
      const d = new Date(input.expiresAt);
      if (isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "expiresAt is not a valid ISO datetime" },
          { status: 400 },
        );
      }
      expiresAt = d;
    }

    const token = mintTokenString();
    const row = await prisma.apiToken.create({
      data: {
        name: input.name,
        token,
        scopes,
        expiresAt,
        createdById: me.id,
      },
    });

    // CRITICAL: this is the only response that ever exposes the full
    // token string. The list endpoint returns the prefix only.
    return NextResponse.json({
      ...serialise(row),
      token,
      // Belt-and-braces: surface a banner string the UI can quote so the
      // user doesn't lose the secret to a stray refresh.
      reveal_warning:
        "Copy this token now — it won't be shown again. Family Hub stores it hashed-by-comparison only.",
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
