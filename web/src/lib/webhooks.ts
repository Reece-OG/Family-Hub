// v4.9.0 — outbound webhook bus.
//
// dispatchEvent(type, payload) is the only thing the rest of the app
// touches. It's fire-and-forget by design: callers should NOT await it
// when they're on a hot path (e.g. inside a request handler). The
// originating request returns immediately while the dispatcher runs
// retries in the background.
//
// Reliability tier: best-effort. The LXC host has a long-lived Node
// process, so in-process retry loops handle the typical "subscriber was
// briefly offline" case fine. Lost deliveries on a process restart are
// acceptable for v1 — a calendar-app webhook is not where you'd store
// the authoritative state anyway.
//
// Signature: HMAC-SHA256(secret, raw JSON body). Subscribers verify by
// recomputing and comparing in constant time. Headers:
//   X-Family-Hub-Event       — event type string (e.g. "reminder.fired")
//   X-Family-Hub-Delivery    — unique ID for this delivery (debug aid)
//   X-Family-Hub-Signature   — "sha256=<hex>"
//   Content-Type             — application/json

import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";

// Public event-type union. Add new strings here as the trigger sites grow.
// Subscribers can ask for any of these in their `events` array; anything
// not in the list is ignored at delivery time.
export const ALL_EVENT_TYPES = [
  "reminder.fired",
  "todo.created",
  "todo.completed",
  "event.created",
  "event.starting",
  // v4.9.6 — kiosk sleep-window transitions. Edge-triggered: device.sleep
  // _started fires once when a kiosk enters its configured night-sleep
  // window, device.sleep_ended fires once when it leaves. Home Assistant
  // (or anything else holding the webhook) uses these to drive HDMI-CEC
  // power-off / power-on on the TV the kiosk is plugged into.
  "device.sleep_started",
  "device.sleep_ended",
] as const;
export type EventType = (typeof ALL_EVENT_TYPES)[number];

export function parseEventList(raw: unknown): EventType[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(ALL_EVENT_TYPES);
  return raw.filter(
    (v): v is EventType => typeof v === "string" && known.has(v),
  );
}

interface SignedPayload {
  body: string;
  signature: string;
  deliveryId: string;
}

function prepareDelivery(
  secret: string,
  type: EventType,
  payload: Record<string, unknown>,
): SignedPayload {
  const deliveryId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  // Stable wrapper around the user-supplied payload so subscribers can
  // depend on `event` / `delivered_at` being present without us reserving
  // those names inside payload itself.
  const envelope = {
    event: type,
    delivered_at: new Date().toISOString(),
    delivery_id: deliveryId,
    data: payload,
  };
  const body = JSON.stringify(envelope);
  const signature =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return { body, signature, deliveryId };
}

// One delivery attempt to a single subscription. Returns the HTTP status
// code on completion, or null on a network-level error.
async function attemptOnce(
  url: string,
  type: EventType,
  signed: SignedPayload,
  timeoutMs = 10_000,
): Promise<{ status: number | null; bodySnippet: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Family-Hub-Event": type,
        "X-Family-Hub-Delivery": signed.deliveryId,
        "X-Family-Hub-Signature": signed.signature,
        // Identify ourselves so subscribers can filter / rate-limit cleanly.
        "User-Agent": "FamilyHub-Webhook/1",
      },
      body: signed.body,
      signal: controller.signal,
      // Sit on a redirect rather than silently following it — HA / n8n
      // shouldn't be 3xx-ing webhook deliveries in normal operation, and
      // following could leak the signature to an unrelated host.
      redirect: "manual",
    });
    let snippet: string | null = null;
    try {
      snippet = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    return { status: res.status, bodySnippet: snippet };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown fetch error";
    return { status: null, bodySnippet: msg.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// Backoff schedule: 1s, 5s, 30s. 4xx errors are NOT retried (the body or
// URL was bad and won't get better). 5xx and network errors retry through
// the schedule. lastSuccess / lastFailure / lastError are stamped on the
// subscription row at the end.
const BACKOFF_MS = [1_000, 5_000, 30_000];

async function deliverWithRetry(
  subscription: {
    id: string;
    url: string;
    secret: string;
  },
  type: EventType,
  payload: Record<string, unknown>,
) {
  const signed = prepareDelivery(subscription.secret, type, payload);
  let lastStatus: number | null = null;
  let lastBody: string | null = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length + 1; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }
    const { status, bodySnippet } = await attemptOnce(
      subscription.url,
      type,
      signed,
    );
    lastStatus = status;
    lastBody = bodySnippet;
    if (status !== null && status >= 200 && status < 300) {
      // 2xx — done.
      await prisma.webhookSubscription
        .update({
          where: { id: subscription.id },
          data: {
            lastSuccessAt: new Date(),
            lastError: null,
          },
        })
        .catch(() => {});
      return;
    }
    if (status !== null && status >= 400 && status < 500) {
      // 4xx — subscriber's contract problem. Don't burn budget retrying.
      break;
    }
    // null status (network failure) or 5xx → fall through to next attempt.
  }
  const errSummary =
    lastStatus === null
      ? `Delivery failed: ${lastBody || "network error"}`
      : `HTTP ${lastStatus}${lastBody ? `: ${lastBody}` : ""}`;
  await prisma.webhookSubscription
    .update({
      where: { id: subscription.id },
      data: {
        lastFailureAt: new Date(),
        lastError: errSummary.slice(0, 500),
      },
    })
    .catch(() => {});
}

// Public entry point. Looks up subscriptions, kicks off in-background
// deliveries with retries. Returns void — callers must NOT depend on the
// outcome of any individual delivery.
//
// Wrapped in a try/catch at the top level because the dispatcher MUST NOT
// throw upward into the originating request handler — a misconfigured
// webhook subscriber should never wedge a todo creation, for example.
export function dispatchEvent(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  // setImmediate keeps the originating request unblocked. Node guarantees
  // it runs after the current call stack unwinds.
  setImmediate(() => {
    dispatchEventNow(type, payload).catch((err) => {
      console.warn(
        "[webhooks] dispatch failed:",
        err instanceof Error ? err.message : err,
      );
    });
  });
}

// Variant that awaits delivery completion. Used by the /test endpoint
// which wants to surface the outcome immediately.
export async function dispatchEventNow(
  type: EventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { enabled: true },
  });
  if (subs.length === 0) return;
  const interested = subs.filter((s) =>
    parseEventList(s.events).includes(type),
  );
  if (interested.length === 0) return;

  await Promise.all(
    interested.map((s) =>
      deliverWithRetry(
        { id: s.id, url: s.url, secret: s.secret },
        type,
        payload,
      ).catch((err) => {
        console.warn(
          "[webhooks] delivery exception",
          s.id,
          err instanceof Error ? err.message : err,
        );
      }),
    ),
  );
}

// Mints a fresh signing secret for a new subscription. Independent of the
// integration token namespace because the two have different threat
// models — a leaked webhook secret only lets an attacker forge replays of
// their own subscriber URL.
export function mintWebhookSecret(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}
