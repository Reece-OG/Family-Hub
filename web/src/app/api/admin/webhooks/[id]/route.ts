// v4.9.0 — single WebhookSubscription: rename, change URL, change events,
// enable/disable, rotate secret, delete.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { ALL_EVENT_TYPES, mintWebhookSecret, type EventType } from "@/lib/webhooks";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().url().max(2000).optional(),
  events: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().optional(),
  // When true, the server mints a fresh signing secret and includes the
  // full string in the response. Caller is expected to paste it into HA
  // immediately and store it — same one-shot reveal as creation.
  rotate_secret: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireParent();
    const input = patchSchema.parse(await req.json());
    const data: {
      name?: string;
      url?: string;
      events?: EventType[];
      enabled?: boolean;
      secret?: string;
    } = {};

    if (input.name !== undefined) data.name = input.name;
    if (input.url !== undefined) data.url = input.url;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.events !== undefined) {
      const known = new Set<string>(ALL_EVENT_TYPES);
      const filtered: EventType[] = input.events.filter(
        (e): e is EventType => known.has(e),
      );
      if (filtered.length === 0) {
        return NextResponse.json(
          {
            error: "Provide at least one valid event type",
            valid_event_types: ALL_EVENT_TYPES,
          },
          { status: 400 },
        );
      }
      data.events = filtered;
    }

    let revealedSecret: string | null = null;
    if (input.rotate_secret) {
      const fresh = mintWebhookSecret();
      data.secret = fresh;
      revealedSecret = fresh;
    }

    const row = await prisma.webhookSubscription.update({
      where: { id: params.id },
      data,
    });

    return NextResponse.json({
      id: row.id,
      name: row.name,
      url: row.url,
      secret_prefix: row.secret.slice(0, 8) + "…",
      enabled: row.enabled,
      last_success_at: row.lastSuccessAt?.toISOString() ?? null,
      last_failure_at: row.lastFailureAt?.toISOString() ?? null,
      last_error: row.lastError,
      ...(revealedSecret
        ? {
            secret: revealedSecret,
            reveal_warning:
              "Copy the rotated secret now — it won't be shown again.",
          }
        : {}),
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
    await prisma.webhookSubscription.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
