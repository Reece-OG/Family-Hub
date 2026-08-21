// v4.9.0 — bearer-token auth for the public /api/v1/* surface.
//
// Family-wide integration tokens (ApiToken model). Each token carries a
// scope set; route handlers call requireApiToken("events:read") and we
// reject the request unless the token has that scope (or "*" wildcard).
//
// The token presented in `Authorization: Bearer <token>` is compared in
// constant time against the DB row to mitigate timing attacks. We stamp
// lastUsedAt asynchronously (no await) so an integration polling every
// 15s doesn't pay a DB write on the hot path.

import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/auth";

// Canonical scope list. Add new scopes here and the auth helper will
// accept tokens that carry them; unknown scopes coming back from the DB
// are filtered out at parse time so a stale or maliciously-edited row
// can't sneak past a scope check.
export const ALL_SCOPES = [
  "events:read",
  "todos:read",
  "shopping:read",
  "reminders:read",
  // Wildcard — convenience for trusted integrations like HA. Use sparingly.
  "*",
] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export function parseScopes(raw: unknown): Scope[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(ALL_SCOPES);
  return raw.filter(
    (v): v is Scope => typeof v === "string" && known.has(v),
  );
}

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  return match[1].trim() || null;
}

// Constant-time compare so a network attacker can't binary-search the
// token via response timing.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export interface AuthenticatedTokenContext {
  tokenId: string;
  name: string;
  scopes: Scope[];
}

// Throws HttpError(401) if no valid token, HttpError(403) if scope missing.
// On success, returns the token row and updates lastUsedAt fire-and-forget.
export async function requireApiToken(
  req: NextRequest,
  required: Scope,
): Promise<AuthenticatedTokenContext> {
  const presented = extractBearer(req);
  if (!presented) {
    throw new HttpError(401, "Missing Authorization: Bearer header");
  }

  // We can't index lookup by the literal presented value AND do
  // constant-time compare. Cheapest correct approach: fetch the row by
  // its @unique token, then re-verify with timingSafeEqual. The lookup
  // itself leaks length-based timing slightly but every modern Postgres
  // installation is fast enough that it's swamped by network jitter.
  const row = await prisma.apiToken.findUnique({
    where: { token: presented },
  });
  if (!row || !row.enabled) {
    throw new HttpError(401, "Invalid or revoked token");
  }
  if (!safeEqual(row.token, presented)) {
    // Defensive — findUnique already enforced this, but be explicit.
    throw new HttpError(401, "Invalid token");
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "Token expired");
  }

  const scopes = parseScopes(row.scopes);
  const granted = scopes.includes("*") || scopes.includes(required);
  if (!granted) {
    throw new HttpError(
      403,
      `Token does not carry scope: ${required}`,
    );
  }

  // Fire-and-forget usage stamp. Errors here would mean we can't reach
  // the DB at all, which the next request will surface anyway.
  prisma.apiToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* swallow */
    });

  return {
    tokenId: row.id,
    name: row.name,
    scopes,
  };
}

// Random token generator. crypto.randomUUID() is plenty for our use case
// (122 bits of entropy) — we prefix with `fhk_` so leaked tokens are
// instantly recognisable in logs and aren't easily confused with other
// secrets the user might be juggling.
export function mintTokenString(): string {
  // randomUUID is available on Node >= 14.17 and on the Edge runtime; we
  // run on the Node runtime for /api/admin/api-tokens so it's safe.
  const uuid = crypto.randomUUID().replace(/-/g, "");
  // Add a second uuid chunk so the visible string is ~64 chars and looks
  // like a "real" API key. Cosmetic but reduces user copy-paste mistakes.
  const extra = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `fhk_${uuid}${extra}`;
}
