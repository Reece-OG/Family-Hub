// v4.9.0 — fires a synthetic event at ONE specific webhook subscription
// so the operator can verify HA / n8n is receiving things correctly.
//
// Unlike normal dispatch (which is fire-and-forget), this awaits delivery
// so the response carries the outcome. We synthesise a tiny payload that
// resembles reminder.fired but with an obvious test marker so HA's logs
// don't get a fake real-event slipped in.

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";

const PROBE_PAYLOAD = {
  event: "test.ping",
  message: "Family Hub webhook delivery test",
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await requireParent();
    const sub = await prisma.webhookSubscription.findUnique({
      where: { id: params.id },
    });
    if (!sub) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    const body = JSON.stringify({
      event: "test.ping",
      delivered_at: new Date().toISOString(),
      delivery_id: `test-${Date.now().toString(36)}`,
      data: PROBE_PAYLOAD,
    });
    const signature =
      "sha256=" + createHmac("sha256", sub.secret).update(body).digest("hex");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let status: number | null = null;
    let bodySnippet: string | null = null;
    let networkError: string | null = null;
    try {
      const res = await fetch(sub.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Family-Hub-Event": "test.ping",
          "X-Family-Hub-Delivery": `test-${Date.now().toString(36)}`,
          "X-Family-Hub-Signature": signature,
          "User-Agent": "FamilyHub-Webhook/1 (test)",
        },
        body,
        signal: controller.signal,
        redirect: "manual",
      });
      status = res.status;
      try {
        bodySnippet = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
    } catch (err) {
      networkError =
        err instanceof Error ? err.message : "unknown fetch error";
    } finally {
      clearTimeout(timer);
    }

    // Record the outcome on the subscription row so the operator sees the
    // last-success / last-failure stamp move when they click Test.
    if (status !== null && status >= 200 && status < 300) {
      await prisma.webhookSubscription
        .update({
          where: { id: sub.id },
          data: { lastSuccessAt: new Date(), lastError: null },
        })
        .catch(() => {});
    } else {
      await prisma.webhookSubscription
        .update({
          where: { id: sub.id },
          data: {
            lastFailureAt: new Date(),
            lastError: (networkError
              ? `Test failed: ${networkError}`
              : `Test got HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ""}`
            ).slice(0, 500),
          },
        })
        .catch(() => {});
    }

    return NextResponse.json({
      ok: status !== null && status >= 200 && status < 300,
      status,
      response_snippet: bodySnippet,
      network_error: networkError,
    });
  } catch (e) {
    return handleError(e);
  }
}
