// Background reminder scheduler.
//
// Strategy: a single setInterval polls the DB every 30s for reminders whose
// remindAt is <= now AND sent = false. For each, we deliver via email (if
// requested and SMTP is configured) and mark sent. In-app delivery is handled
// client-side — the browser polls /api/reminders/poll for due+unacknowledged
// rows and renders toasts.
//
// The scheduler starts lazily on first import from the server and installs
// itself on globalThis so Next's dev-mode hot reload doesn't spawn duplicates.

import { prisma } from "./prisma";
import { sendEmail } from "./email";
import { expandOccurrences, ruleFromRow } from "./recurrence";
import { APP_NAME } from "./app-name";

// v4.7.11 — DO NOT statically import "./push" here. lib/push.ts pulls in
// the `web-push` package, which transitively requires Node's net/http/https
// builtins. Even though instrumentation.ts only ever calls
// startReminderScheduler() on the nodejs runtime, webpack still walks the
// static import graph for the Edge bundle and explodes when it can't
// resolve those builtins. A dynamic import inside the dispatch loop keeps
// push.ts out of the Edge bundle's reachable graph entirely.
type SendPushToUser = (
  userId: string,
  payload: {
    title: string;
    body?: string;
    tag?: string;
    url?: string;
  },
  // v4.8.1 — optional per-send delivery hints. The dispatcher passes
  // urgency: "high" + a TTL bounded by relevance so iOS / FCM don't defer
  // time-sensitive reminders.
  options?: {
    urgency?: "very-low" | "low" | "normal" | "high";
    ttlSeconds?: number;
  },
) => Promise<unknown>;

const POLL_INTERVAL_MS = 30_000;
const GLOBAL_KEY = "__familyHubReminderSchedulerStarted__";

type SchedulerState = {
  timer: NodeJS.Timeout;
  startedAt: Date;
};

function getGlobalState(): SchedulerState | null {
  // @ts-expect-error – attaching to globalThis is intentional
  return (globalThis[GLOBAL_KEY] as SchedulerState | undefined) ?? null;
}

function setGlobalState(s: SchedulerState | null) {
  // @ts-expect-error – attaching to globalThis is intentional
  globalThis[GLOBAL_KEY] = s ?? undefined;
}

export function startReminderScheduler() {
  if (getGlobalState()) return;
  const timer = setInterval(() => {
    tickReminderScheduler().catch((err) =>
      console.warn(
        "[reminder-scheduler] tick failed:",
        err instanceof Error ? err.message : err,
      ),
    );
  }, POLL_INTERVAL_MS);
  // Don't hold the process open just for this timer.
  if (typeof timer === "object" && "unref" in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
  setGlobalState({ timer, startedAt: new Date() });
  console.log("[reminder-scheduler] started");
}

export function stopReminderScheduler() {
  const s = getGlobalState();
  if (!s) return;
  clearInterval(s.timer);
  setGlobalState(null);
}

export async function tickReminderScheduler() {
  const now = new Date();

  // First, spawn Reminder rows for any maintenance items whose service is due
  // and haven't been nagged about yet. The newly-created reminders then flow
  // through the normal dispatch path below.
  await spawnMaintenanceReminders(now);

  // Also spawn reminders for registration/insurance nearing expiry.
  await spawnMaintenanceExpiryReminders(now);

  // Then, spawn Reminder rows for any event lead-times whose trigger is in the
  // next window. We use sourceEventReminderId + remindAt as the dedupe key so
  // recurring events can fire again for each occurrence.
  await spawnEventReminders(now);

  // v4.9.0 — fire `event.starting` webhooks for events whose start falls
  // inside the current tick window. Decoupled from the EventReminder row
  // creation above so an event without any reminders attached still
  // notifies integrations when it kicks off.
  await dispatchEventStartingWebhooks(now);

  // v4.9.6 — fire `device.sleep_started` / `device.sleep_ended` webhooks
  // when a kiosk enters or leaves its configured night-sleep window. The
  // canonical use case is wiring this to Home Assistant's HDMI-CEC
  // integration so the TV the kiosk is plugged into actually powers off
  // overnight instead of holding a black overlay on full backlight.
  await dispatchDeviceSleepTransitions(now);

  const due = await prisma.reminder.findMany({
    where: {
      sent: false,
      remindAt: { lte: now },
    },
    include: { user: true },
    take: 25, // process in small batches
    orderBy: { remindAt: "asc" },
  });

  for (const r of due) {
    let deliveryError: string | null = null;

    if (r.deliveryEmail) {
      try {
        const result = await sendEmail({
          to: r.user.email,
          subject: `Reminder: ${r.title}`,
          text: buildEmailText(r.title, r.body, r.remindAt, r.user.name),
          html: buildEmailHtml(r.title, r.body, r.remindAt, r.user.name),
        });
        if (result.skipped) {
          deliveryError =
            "Email delivery skipped — SMTP is not configured in settings.";
        }
      } catch (err) {
        deliveryError =
          err instanceof Error ? err.message : "Unknown email error";
      }
    }

    // v4.7.9 — Web Push fan-out. Per the user's enrol-piggybacks-on-toast
    // model, we send a push whenever an in-app toast is requested. Push
    // is the *only* way to reach a backgrounded mobile, so it doesn't
    // make sense to gate behind a separate flag. Failures are
    // non-fatal — we keep the email-shaped deliveryError as the
    // primary surface and only log the push outcome.
    //
    // v4.7.11 — push.ts is dynamically imported (instead of a top-of-
    // file `import`) so the Edge bundle never has to resolve web-push's
    // Node-only deps. See note at the top of this file.
    if (r.deliveryInApp) {
      try {
        const { sendPushToUser } = (await import("./push")) as {
          sendPushToUser: SendPushToUser;
        };
        // v4.8.1 — reminders go out at urgency: "high" so iOS / FCM don't
        // defer them under low-power mode, and with a TTL bounded by the
        // useful relevance window (8 hours) so a phone that comes back
        // online tomorrow doesn't get yesterday's reminders.
        await sendPushToUser(
          r.userId,
          {
            title: `Reminder: ${r.title}`,
            body: r.body || `Scheduled for ${r.remindAt.toLocaleString()}`,
            tag: `reminder-${r.id}`,
            url: "/reminders",
          },
          { urgency: "high", ttlSeconds: 8 * 60 * 60 },
        );
      } catch (err) {
        // Don't propagate — push is best-effort. A delivery error here
        // shouldn't stop the rest of the dispatch loop.
        console.warn(
          "[reminder-scheduler] push delivery failed for",
          r.id,
          err instanceof Error ? err.message : err,
        );
      }
    }

    await prisma.reminder.update({
      where: { id: r.id },
      data: {
        sent: true,
        sentAt: new Date(),
        deliveryError,
      },
    });

    // v4.9.0 — fire the public webhook event so HA / n8n / etc. can react
    // to reminders without polling. Dynamically imported to keep the Edge
    // bundle clean (the same reason push.ts is lazy-loaded above).
    try {
      const { dispatchEvent } = await import("./webhooks");
      dispatchEvent("reminder.fired", {
        id: r.id,
        user_id: r.userId,
        user_name: r.user.name,
        title: r.title,
        body: r.body,
        remind_at: r.remindAt.toISOString(),
        source_event_reminder_id: r.sourceEventReminderId,
      });
    } catch (err) {
      console.warn(
        "[reminder-scheduler] webhook dispatch failed for",
        r.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { processed: due.length };
}

// For each MaintenanceItem whose nextServiceDue has passed and that hasn't
// yet had a reminder spawned, insert a Reminder for the owner and stamp the
// item so we don't nag repeatedly. The reminder is set to "now" so the normal
// dispatch path picks it up on this same tick.
async function spawnMaintenanceReminders(now: Date) {
  const overdue = await prisma.maintenanceItem.findMany({
    where: {
      remindEnabled: true,
      nextServiceDue: { lte: now },
      lastReminderSpawnedAt: null,
    },
    include: { owner: true },
    take: 25,
  });

  for (const item of overdue) {
    try {
      await prisma.$transaction([
        prisma.reminder.create({
          data: {
            userId: item.ownerId,
            title: `Service due: ${item.name}`,
            body:
              `It's time to service ${item.name} (every ${item.serviceIntervalMonths} ` +
              `month${item.serviceIntervalMonths === 1 ? "" : "s"}).` +
              (item.identifier ? ` Identifier: ${item.identifier}.` : ""),
            remindAt: now,
            deliveryInApp: true,
            deliveryEmail: false,
          },
        }),
        prisma.maintenanceItem.update({
          where: { id: item.id },
          data: { lastReminderSpawnedAt: now },
        }),
      ]);
    } catch (err) {
      console.warn(
        "[reminder-scheduler] maintenance spawn failed for",
        item.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// Spawn one-off reminders when registration / insurance is within 30 days of
// expiry. The per-kind *ReminderSpawnedAt column is cleared whenever the user
// edits the expiry date, so the reminder fires again for each new policy term.
async function spawnMaintenanceExpiryReminders(now: Date) {
  const LEAD_DAYS = 30;
  const horizon = new Date(now.getTime() + LEAD_DAYS * 24 * 60 * 60_000);

  const registrationDue = await prisma.maintenanceItem.findMany({
    where: {
      remindEnabled: true,
      registrationExpiresAt: { not: null, lte: horizon },
      registrationReminderSpawnedAt: null,
    },
    include: { owner: true },
    take: 25,
  });

  for (const item of registrationDue) {
    if (!item.registrationExpiresAt) continue;
    try {
      await prisma.$transaction([
        prisma.reminder.create({
          data: {
            userId: item.ownerId,
            title: `Registration expiring: ${item.name}`,
            body:
              `Registration for ${item.name} expires on ` +
              `${item.registrationExpiresAt.toLocaleDateString()}.` +
              (item.registrationNumber
                ? ` Number: ${item.registrationNumber}.`
                : ""),
            remindAt: now,
            deliveryInApp: true,
            deliveryEmail: false,
          },
        }),
        prisma.maintenanceItem.update({
          where: { id: item.id },
          data: { registrationReminderSpawnedAt: now },
        }),
      ]);
    } catch (err) {
      console.warn(
        "[reminder-scheduler] registration spawn failed for",
        item.id,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const insuranceDue = await prisma.maintenanceItem.findMany({
    where: {
      remindEnabled: true,
      insuranceExpiresAt: { not: null, lte: horizon },
      insuranceReminderSpawnedAt: null,
    },
    include: { owner: true },
    take: 25,
  });

  for (const item of insuranceDue) {
    if (!item.insuranceExpiresAt) continue;
    try {
      await prisma.$transaction([
        prisma.reminder.create({
          data: {
            userId: item.ownerId,
            title: `Insurance expiring: ${item.name}`,
            body:
              `Insurance for ${item.name} expires on ` +
              `${item.insuranceExpiresAt.toLocaleDateString()}.` +
              (item.insuranceProvider
                ? ` Provider: ${item.insuranceProvider}.`
                : "") +
              (item.insurancePolicyNumber
                ? ` Policy: ${item.insurancePolicyNumber}.`
                : ""),
            remindAt: now,
            deliveryInApp: true,
            deliveryEmail: false,
          },
        }),
        prisma.maintenanceItem.update({
          where: { id: item.id },
          data: { insuranceReminderSpawnedAt: now },
        }),
      ]);
    } catch (err) {
      console.warn(
        "[reminder-scheduler] insurance spawn failed for",
        item.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// Look ahead a small window for upcoming event lead-times and materialize
// Reminder rows for each participant. The dedupe key is (sourceEventReminderId,
// remindAt) so recurring events can legitimately re-fire for each occurrence
// without us double-spawning within a single occurrence.
async function spawnEventReminders(now: Date) {
  // How far ahead we scan. Needs to comfortably exceed POLL_INTERVAL_MS so a
  // skipped tick (process restart, long GC pause) doesn't miss a window.
  const LOOKAHEAD_MS = 5 * 60_000; // 5 minutes
  const LOOKBACK_MS = 60_000; // tolerate a minute of clock skew
  const windowStart = new Date(now.getTime() - LOOKBACK_MS);
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_MS);

  // For expanding recurring events we look at occurrences starting between
  // now and now + (maxLead + lookahead). The max stored lead is 30 days.
  const MAX_LEAD_MS = 30 * 24 * 60 * 60_000;
  const occurrenceWindowEnd = new Date(windowEnd.getTime() + MAX_LEAD_MS);

  const eventReminders = await prisma.eventReminder.findMany({
    include: {
      event: {
        include: {
          participants: { select: { userId: true } },
        },
      },
    },
    take: 500,
  });

  for (const er of eventReminders) {
    try {
      const rule = ruleFromRow(er.event);
      const leadMs = er.minutesBefore * 60_000;

      // Compute candidate trigger instants. For a non-recurring event, that's
      // just (startAt - lead). For a recurring one, expand every occurrence
      // whose trigger falls inside the scan window.
      const candidates: Date[] = [];
      if (!rule) {
        const trigger = new Date(er.event.startAt.getTime() - leadMs);
        if (trigger >= windowStart && trigger <= windowEnd) {
          candidates.push(trigger);
        }
      } else {
        const occs = expandOccurrences(
          {
            id: er.event.id,
            startAt: er.event.startAt,
            endAt: er.event.endAt,
            recurrence: rule,
          },
          new Date(windowStart.getTime() + leadMs),
          new Date(occurrenceWindowEnd.getTime()),
        );
        for (const o of occs) {
          const trigger = new Date(o.occurrenceStart.getTime() - leadMs);
          if (trigger >= windowStart && trigger <= windowEnd) {
            candidates.push(trigger);
          }
        }
      }

      if (candidates.length === 0) continue;

      // Figure out who should receive the toast. Participants if any,
      // otherwise the creator as a sensible fallback so the reminder isn't
      // silently dropped.
      const baseRecipientIds = er.event.participants.length
        ? er.event.participants.map((p) => p.userId)
        : [er.event.createdById];

      // v4.8.1 — route by the two new flags:
      //   • User.receivesOwnEventReminders: kid-side kill switch parents
      //     can flip from Family settings. When false, the kid doesn't get
      //     a Reminder spawned at all.
      //   • UserPermissions.notifyOnChildEventReminders: parent's personal
      //     "also notify me when my kids have events" toggle. When true,
      //     every CHILD recipient triggers a piggy-back Reminder on the
      //     parent so they get the same heads-up.
      //
      // We do the lookups once per spawn pass (rare, max ~5 mins ahead)
      // instead of per-trigger to keep the DB cost flat.
      const baseUsers = baseRecipientIds.length
        ? await prisma.user.findMany({
            where: { id: { in: baseRecipientIds } },
            select: {
              id: true,
              role: true,
              receivesOwnEventReminders: true,
            },
          })
        : [];

      // Drop kids who've been opted out by their parents.
      const acceptingIds = baseUsers
        .filter((u) => u.receivesOwnEventReminders)
        .map((u) => u.id);

      // Any kids still in the recipient list trigger a shadow Reminder on
      // any opted-in parents. Build the parent set once per pass.
      const kidIds = baseUsers
        .filter((u) => u.role === "CHILD" && u.receivesOwnEventReminders)
        .map((u) => u.id);

      let shadowParentIds: string[] = [];
      if (kidIds.length > 0) {
        const optedInParents = await prisma.user.findMany({
          where: {
            role: "PARENT",
            permissions: { notifyOnChildEventReminders: true },
          },
          select: { id: true },
        });
        shadowParentIds = optedInParents.map((p) => p.id);
      }

      // Final recipient list: kids who didn't opt out + adults from the
      // participant set + shadow-subscribed parents, deduped.
      const recipientIds = Array.from(
        new Set<string>([...acceptingIds, ...shadowParentIds]),
      );
      if (recipientIds.length === 0) continue;

      for (const trigger of candidates) {
        // Skip if we've already spawned this exact occurrence.
        const already = await prisma.reminder.findFirst({
          where: {
            sourceEventReminderId: er.id,
            remindAt: trigger,
          },
          select: { id: true },
        });
        if (already) continue;

        const body = buildEventReminderBody(er, trigger);

        await prisma.$transaction(
          recipientIds.map((uid) =>
            prisma.reminder.create({
              data: {
                userId: uid,
                title: `Event: ${er.event.title}`,
                body,
                remindAt: trigger,
                deliveryInApp: er.deliveryInApp,
                deliveryEmail: er.deliveryEmail,
                sourceEventReminderId: er.id,
              },
            }),
          ),
        );
      }
    } catch (err) {
      console.warn(
        "[reminder-scheduler] event spawn failed for",
        er.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// v4.9.0 — in-memory dedup for event.starting webhook dispatches. Keyed
// by `${eventId}:${occurrenceStartISO}` so each recurrence fires once.
// Lost on process restart, which is acceptable — the LOOKBACK window is
// small enough that a restart only risks re-firing events that just
// started, and subscribers should be idempotent anyway.
//
// We cap the set at 1000 entries so a busy household doesn't grow it
// unboundedly across days of uptime.
const EVENT_STARTING_FIRED = new Set<string>();
const EVENT_STARTING_FIRED_CAP = 1000;

function rememberEventStartingFire(key: string) {
  if (EVENT_STARTING_FIRED.size >= EVENT_STARTING_FIRED_CAP) {
    // Drop the oldest insertion. Sets preserve insertion order so the
    // first entry from values() is the oldest.
    const oldest = EVENT_STARTING_FIRED.values().next().value;
    if (oldest) EVENT_STARTING_FIRED.delete(oldest);
  }
  EVENT_STARTING_FIRED.add(key);
}

async function dispatchEventStartingWebhooks(now: Date) {
  // Window: looking back ~tick interval + a fudge factor so a slow tick
  // doesn't miss an event. We can be generous because the in-memory
  // dedup makes double-fires impossible within a single process.
  const LOOKBACK_MS = 90_000;
  const windowStart = new Date(now.getTime() - LOOKBACK_MS);

  // Fetch every event whose nominal start falls in the window (non-
  // recurring) OR whose recurrence rule could plausibly have spawned an
  // occurrence in this window. Cheap upper bound: any recurring event
  // whose original startAt is in the past gets considered (expanding
  // each row's occurrences is what gives us the actual list).
  const candidates = await prisma.event.findMany({
    where: {
      OR: [
        { recurrenceFrequency: null, startAt: { gte: windowStart, lte: now } },
        { recurrenceFrequency: { not: null }, startAt: { lte: now } },
      ],
    },
    take: 200,
  });
  if (candidates.length === 0) return;

  // Lazy import keeps the Edge bundle clean (same pattern as the push helper).
  const { dispatchEvent } = await import("./webhooks");

  for (const ev of candidates) {
    const rule = ruleFromRow(ev);
    const occurrences: Date[] = [];
    if (!rule) {
      occurrences.push(ev.startAt);
    } else {
      try {
        const occs = expandOccurrences(
          {
            id: ev.id,
            startAt: ev.startAt,
            endAt: ev.endAt,
            recurrence: rule,
          },
          windowStart,
          now,
        );
        for (const o of occs) occurrences.push(o.occurrenceStart);
      } catch (err) {
        console.warn(
          "[reminder-scheduler] event.starting recurrence expand failed for",
          ev.id,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
    }

    for (const start of occurrences) {
      if (start < windowStart || start > now) continue;
      const key = `${ev.id}:${start.toISOString()}`;
      if (EVENT_STARTING_FIRED.has(key)) continue;
      rememberEventStartingFire(key);

      try {
        dispatchEvent("event.starting", {
          event_id: ev.id,
          title: ev.title,
          description: ev.description,
          location: ev.location,
          start_at: start.toISOString(),
          end_at: new Date(
            start.getTime() + (ev.endAt.getTime() - ev.startAt.getTime()),
          ).toISOString(),
          all_day: ev.allDay,
          recurring: Boolean(rule),
        });
      } catch (err) {
        console.warn(
          "[reminder-scheduler] event.starting dispatch failed for",
          ev.id,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

// v4.9.6 — per-device "are we sleeping right now?" state, kept in memory so
// we can fire EDGE-TRIGGERED webhooks (sleep_started, sleep_ended) instead
// of polling subscribers. Lost on process restart is acceptable — the
// next tick simply re-establishes ground truth without firing any event
// for whatever the boot-time state happens to be. That's correct: HA
// shouldn't power-cycle a TV just because the Family Hub app restarted.
const DEVICE_SLEEP_STATE = new Map<string, "awake" | "sleeping">();

// Resolve whether a configured kiosk is inside its night-sleep window
// right now. Times are stored as "HH:mm" in the device's local clock; we
// support midnight-wrapping windows (e.g. 22:00 → 07:00) by comparing
// either side of the wrap.
function isInSleepWindow(
  cfg: { sleepStartTime: string; sleepEndTime: string },
  now: Date,
): boolean {
  const [sh, sm] = cfg.sleepStartTime.split(":").map(Number);
  const [eh, em] = cfg.sleepEndTime.split(":").map(Number);
  if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  return start < end
    ? minsNow >= start && minsNow < end
    : minsNow >= start || minsNow < end;
}

async function dispatchDeviceSleepTransitions(now: Date) {
  const devices = await prisma.localDevice.findMany({
    where: { sleepModeEnabled: true },
    select: {
      id: true,
      name: true,
      location: true,
      sleepStartTime: true,
      sleepEndTime: true,
    },
  });
  if (devices.length === 0) return;

  // Lazy import keeps the Edge bundle clean (matches the existing push
  // / webhook import pattern in this file).
  const { dispatchEvent } = await import("./webhooks");

  for (const d of devices) {
    const current: "awake" | "sleeping" = isInSleepWindow(d, now)
      ? "sleeping"
      : "awake";
    const prev = DEVICE_SLEEP_STATE.get(d.id);
    if (prev === undefined) {
      // First sighting since process start. Stamp ground truth without
      // emitting a transition — the kiosk has been in this state since
      // before we booted, so neither "started sleeping NOW" nor "stopped
      // sleeping NOW" is true.
      DEVICE_SLEEP_STATE.set(d.id, current);
      continue;
    }
    if (prev === current) continue;
    DEVICE_SLEEP_STATE.set(d.id, current);

    try {
      const event =
        current === "sleeping" ? "device.sleep_started" : "device.sleep_ended";
      dispatchEvent(event, {
        device_id: d.id,
        device_name: d.name,
        location: d.location,
        sleep_start: d.sleepStartTime,
        sleep_end: d.sleepEndTime,
      });
    } catch (err) {
      console.warn(
        "[reminder-scheduler] device sleep transition dispatch failed for",
        d.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

function buildEventReminderBody(
  er: { minutesBefore: number; event: { startAt: Date; location: string | null; description: string | null } },
  trigger: Date,
): string {
  const lead = er.minutesBefore;
  let when = "at start";
  if (lead > 0) {
    if (lead % (60 * 24) === 0) {
      const d = lead / (60 * 24);
      when = `in ${d} day${d === 1 ? "" : "s"}`;
    } else if (lead % 60 === 0) {
      const h = lead / 60;
      when = `in ${h} hour${h === 1 ? "" : "s"}`;
    } else {
      when = `in ${lead} minute${lead === 1 ? "" : "s"}`;
    }
  }
  const parts = [`Starts ${when} (${er.event.startAt.toLocaleString()}).`];
  if (er.event.location) parts.push(`Where: ${er.event.location}.`);
  if (er.event.description) {
    const trimmed = er.event.description.replace(/\s+/g, " ").trim();
    parts.push(trimmed.length > 160 ? trimmed.slice(0, 157) + "…" : trimmed);
  }
  return parts.join(" ");
}

function buildEmailText(
  title: string,
  body: string | null,
  at: Date,
  name: string,
) {
  return [
    `Hi ${name},`,
    "",
    `Reminder: ${title}`,
    body ? "" : null,
    body ?? null,
    "",
    `Scheduled for ${at.toLocaleString()}`,
    "",
    `— ${APP_NAME}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function buildEmailHtml(
  title: string,
  body: string | null,
  at: Date,
  name: string,
) {
  const safe = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<!doctype html>
<html><body style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 16px;">
  <p>Hi ${safe(name)},</p>
  <h2 style="margin: 12px 0;">${safe(title)}</h2>
  ${body ? `<p>${safe(body).replace(/\n/g, "<br>")}</p>` : ""}
  <p style="color:#666;font-size:14px;">Scheduled for ${safe(at.toLocaleString())}</p>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">
  <p style="color:#999;font-size:12px;">— ${safe(APP_NAME)}</p>
</body></html>`;
}
