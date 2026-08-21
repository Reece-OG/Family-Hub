// v4.9.0 — parent-only CRUD for outbound webhook subscriptions.
//
// GET  /api/admin/webhooks       — list (secret never returned — see below)
// POST /api/admin/webhooks       — create. Secret is auto-minted and
//                                  returned ONCE in this response so the
//                                  operator can paste it into HA's HMAC
//                                  verifier config. Subsequent reads only
//                                  return a redacted prefix.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import {
  ALL_EVENT_TYPES,
  mintWebhookSecret,
  parseEventList,
  type EventType,
} from "@/lib/webhooks";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url().max(2000),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().optional(),
});

function serialise(w: {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: unknown;
  enabled: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}) {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    // Same convention as the API tokens: secret string is fully revealed
    // only once at create-time; lists return the prefix.
    secret_prefix: w.secret.slice(0, 8) + "…",
    events: parseEventList(w.events),
    enabled: w.enabled,
    last_success_at: w.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: w.lastFailureAt?.toISOString() ?? null,
    last_error: w.lastError,
    created_at: w.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    await requireParent();
    const rows = await prisma.webhookSubscription.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ webhooks: rows.map(serialise) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireParent();
    const input = createSchema.parse(await req.json());

    // Server-side filter the event list against the catalogue. A
    // subscription with zero valid event types is useless, so reject.
    const known = new Set<string>(ALL_EVENT_TYPES);
    const events: EventType[] = input.events.filter(
      (e): e is EventType => known.has(e),
    );
    if (events.length === 0) {
      return NextResponse.json(
        {
          error: "Provide at least one valid event type",
          valid_event_types: ALL_EVENT_TYPES,
        },
        { status: 400 },
      );
    }

    const secret = mintWebhookSecret();
    const row = await prisma.webhookSubscription.create({
      data: {
        name: input.name,
        url: input.url,
        secret,
        events,
        enabled: input.enabled ?? true,
        createdById: me.id,
      },
    });

    return NextResponse.json({
      ...serialise(row),
      secret,
      reveal_warning:
        "Copy this signing secret now — it won't be shown again. HA / n8n need it to verify the X-Family-Hub-Signature header.",
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
