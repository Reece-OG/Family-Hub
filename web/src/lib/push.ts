// =============================================================================
//  Family Hub — Web Push (v4.7.9)
// =============================================================================
//
//  Server-side helpers for the Web Push API. The big idea:
//    1. Each browser/device the user enrols stores a row in PushSubscription
//       with the endpoint URL + encryption keys it got from the OS.
//    2. When a reminder is due, sendPushToUser(userId, payload) fans the
//       payload out to every subscription. web-push handles the AES-GCM
//       envelope + VAPID signing.
//    3. On a 410 Gone or 404 (subscription expired or revoked) we delete
//       the dead row so we don't keep nagging it. Other failures stamp
//       lastError but leave the row in place.
//
//  VAPID keys are generated lazily on first use and stored on the
//  AppSettings singleton (`pushVapidPublicKey` / `pushVapidPrivateKey`)
//  so push "just works" out of the box without any install-time config.

import webpush from "web-push";
import { prisma } from "./prisma";

// Keep the configured-state in module scope so we don't reset web-push's
// VAPID details every time we send. The DB row is the source of truth;
// this is just a flag that says "we've already pushed it into web-push
// for this process".
let webPushConfigured = false;

export type PushPayload = {
  title: string;
  body?: string;
  // tag groups notifications so a second reminder for the same item
  // replaces the first instead of stacking.
  tag?: string;
  // URL to focus / open on click — defaults to "/" inside sw.js.
  url?: string;
  // App icon path (large square shown next to the body on most platforms).
  icon?: string;
  // Monochrome badge (Android status bar icon).
  badge?: string;
};

// v4.8.1 — per-send delivery hints. Apple's push service (and Mozilla's, to a
// lesser extent) downgrade or defer "normal" urgency pushes — sometimes for
// hours — when the device is in low-power mode or background. For things
// that are time-sensitive (event reminders, maintenance nags), set
// urgency: "high" so the kernel delivers immediately.
//
// `ttlSeconds` caps how long a push service will hold the payload before
// dropping it. We default to 4 hours, which matches typical
// reminder relevance. The reminder dispatcher passes a bounded value so a
// stale reminder is never delivered to a phone that comes online days later.
export type PushSendOptions = {
  urgency?: "very-low" | "low" | "normal" | "high";
  ttlSeconds?: number;
};

const DEFAULT_TTL_SECONDS = 4 * 60 * 60; // 4 hours
const DEFAULT_URGENCY: PushSendOptions["urgency"] = "normal";

// -----------------------------------------------------------------------------
//  VAPID key management
// -----------------------------------------------------------------------------

// v4.8.1 — old default used the .local TLD which some push services
// (notably Apple's) reject as an invalid mailto target, causing every
// reminder to silently fail to deliver to iOS PWAs. We auto-migrate the
// stored subject the first time we read it after an upgrade.
const LEGACY_VAPID_SUBJECT = "mailto:admin@family-hub.local";
const DEFAULT_VAPID_SUBJECT = "mailto:admin@example.com";

async function loadOrGenerateVapid(): Promise<{
  publicKey: string;
  privateKey: string;
  subject: string;
}> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
  });
  if (settings?.pushVapidPublicKey && settings.pushVapidPrivateKey) {
    let subject = settings.pushVapidSubject ?? DEFAULT_VAPID_SUBJECT;
    // One-shot migration of pre-v4.8.1 installs.
    if (subject === LEGACY_VAPID_SUBJECT) {
      subject = DEFAULT_VAPID_SUBJECT;
      await prisma.appSettings
        .update({
          where: { id: "singleton" },
          data: { pushVapidSubject: subject },
        })
        .catch(() => {
          /* non-fatal — we'll keep retrying on every cold start */
        });
    }
    return {
      publicKey: settings.pushVapidPublicKey,
      privateKey: settings.pushVapidPrivateKey,
      subject,
    };
  }

  // First-time setup: generate a fresh pair and persist.
  const fresh = webpush.generateVAPIDKeys();
  // Concurrent first-load is unlikely (settings comes from a singleton)
  // but be defensive: upsert rather than update so a missing row doesn't
  // crash the whole flow.
  const storedSubject = settings?.pushVapidSubject ?? DEFAULT_VAPID_SUBJECT;
  const subject =
    storedSubject === LEGACY_VAPID_SUBJECT ? DEFAULT_VAPID_SUBJECT : storedSubject;
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      pushVapidPublicKey: fresh.publicKey,
      pushVapidPrivateKey: fresh.privateKey,
      pushVapidSubject: subject,
    },
    update: {
      pushVapidPublicKey: fresh.publicKey,
      pushVapidPrivateKey: fresh.privateKey,
      pushVapidSubject: subject,
    },
  });
  return { publicKey: fresh.publicKey, privateKey: fresh.privateKey, subject };
}

export async function ensureVapidConfigured(): Promise<{
  publicKey: string;
  subject: string;
}> {
  const { publicKey, privateKey, subject } = await loadOrGenerateVapid();
  if (!webPushConfigured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    webPushConfigured = true;
  }
  return { publicKey, subject };
}

export async function getVapidPublicKey(): Promise<string> {
  const { publicKey } = await ensureVapidConfigured();
  return publicKey;
}

// -----------------------------------------------------------------------------
//  Sending
// -----------------------------------------------------------------------------

type DeliveryResult = {
  delivered: number;
  failed: number;
  pruned: number;
};

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  options: PushSendOptions = {},
): Promise<DeliveryResult> {
  await ensureVapidConfigured();

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let delivered = 0;
  let failed = 0;
  let pruned = 0;

  // v4.8.1 — per-send delivery hints. The reminder scheduler bumps these to
  // urgency: "high" + a TTL bounded by the reminder's own lifespan; the
  // generic test push leaves them at defaults.
  const sendOptions = {
    TTL: Math.max(0, Math.floor(options.ttlSeconds ?? DEFAULT_TTL_SECONDS)),
    urgency: options.urgency ?? DEFAULT_URGENCY,
  };

  // Run sends in parallel — there's typically only a handful per user.
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
          sendOptions,
        );
        delivered += 1;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSuccessAt: new Date(), lastError: null },
        });
      } catch (err) {
        // 404 / 410 mean the browser has revoked or expired this
        // subscription; clean it up so we stop wasting send budget on it.
        const status =
          typeof err === "object" && err !== null && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          pruned += 1;
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          return;
        }
        failed += 1;
        const msg =
          err instanceof Error ? err.message : "unknown push error";
        await prisma.pushSubscription
          .update({
            where: { id: sub.id },
            data: { lastFailureAt: new Date(), lastError: msg.slice(0, 500) },
          })
          .catch(() => {});
      }
    }),
  );

  return { delivered, failed, pruned };
}

// One-off send for the Test button in Settings.
export async function sendTestPushToUser(userId: string): Promise<DeliveryResult> {
  return sendPushToUser(userId, {
    title: "Family Hub — test push",
    body: "If you can see this, push notifications are working on this device.",
    tag: "familyhub-test",
    url: "/",
  });
}
