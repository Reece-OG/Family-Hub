# Family Hub Public API & Webhooks

_Available from v4.9.0._

Family Hub exposes a small read-only REST surface and an outbound webhook
bus designed for integration with Home Assistant, n8n, scripts, and
similar self-hosted tooling. Everything described here runs alongside the
session-cookie interface used by the web app — those routes (`/api/...`
without the `v1` prefix) are still private to the browser session and are
not covered by this document.

## Configuring an integration

Both API tokens and webhook subscriptions are created and revoked from
**Settings → Integrations** (parents only). Secret strings (tokens and
webhook signing secrets) are shown **exactly once** at creation time.
Family Hub never stores or returns them again after that initial reveal;
losing one means rotating it.

## REST API

### Auth

Every request to `/api/v1/*` must carry an `Authorization: Bearer <token>`
header. Tokens are family-wide (not per-user) and carry a list of scopes.
A request whose required scope is not in the token's scope set responds
`403 Forbidden`.

| Scope | Endpoints it unlocks |
| --- | --- |
| `events:read` | `GET /api/v1/events` |
| `todos:read` | `GET /api/v1/todos` |
| `shopping:read` | `GET /api/v1/shopping` |
| `reminders:read` | `GET /api/v1/reminders` |
| `*` | Wildcard — grants every scope above |

Disabled, expired, or unknown tokens respond `401 Unauthorized`.

### `GET /api/v1/events`

Returns calendar events (and expanded recurring occurrences) in a window.

Query parameters:

- `from` — ISO 8601 datetime. Defaults to "now".
- `to` — ISO 8601 datetime. Defaults to `from + 30 days`. Clamped to a
  maximum of `from + 365 days`.
- `limit` — maximum events to return. Defaults to `200`, max `500`.

Response:

```json
{
  "from": "2026-05-27T12:00:00.000Z",
  "to": "2026-06-26T12:00:00.000Z",
  "count": 4,
  "events": [
    {
      "id": "ckxy123…",
      "title": "School pickup",
      "description": null,
      "start_at": "2026-05-27T15:00:00.000Z",
      "end_at": "2026-05-27T15:30:00.000Z",
      "all_day": false,
      "location": "Greenacre Primary",
      "color": "#7c3aed",
      "starred": false,
      "recurring": true,
      "created_by_id": "ckdad456…",
      "occurrence_start": "2026-05-28T15:00:00.000Z"
    }
  ]
}
```

`start_at` / `end_at` describe the canonical (first) instance.
`occurrence_start` is the actual moment that instance fires inside the
requested window. For non-recurring events, the two will match.

### `GET /api/v1/todos`

Returns open to-dos (and optionally completed ones).

Query parameters:

- `include_done=1` — include completed to-dos.
- `assignee_id=<userId>` — filter to one assignee.
- `category_id=<categoryId>` — filter to one category.
- `limit` — defaults to `200`, max `500`.

### `GET /api/v1/shopping`

Returns the shopping list. By default only outstanding items.

Query parameters:

- `include_done=1` — include ticked rows.
- `category=<name>` — filter to one category bucket.
- `limit` — defaults to `200`, max `500`.

### `GET /api/v1/reminders`

Returns scheduled reminders.

Query parameters:

- `include_sent=1` — include reminders that have already fired.
- `user_id=<userId>` — filter to a single recipient.
- `from`, `to` — restrict `remind_at` to a window (ISO datetime).
- `limit` — defaults to `200`, max `500`.

## Webhooks

When a subscribed event fires, Family Hub POSTs a JSON envelope to the
configured URL. Deliveries retry up to four total attempts on `5xx`
responses or network errors (`1s`, `5s`, `30s` backoff). `4xx` responses
are not retried — they're treated as "your URL is misconfigured".

### Envelope

```json
{
  "event": "reminder.fired",
  "delivered_at": "2026-05-27T08:15:03.412Z",
  "delivery_id": "kp4nq3-9q5xs2",
  "data": { /* event-type-specific payload */ }
}
```

### Headers

| Header | Meaning |
| --- | --- |
| `Content-Type` | Always `application/json`. |
| `X-Family-Hub-Event` | Event type string (e.g. `reminder.fired`). |
| `X-Family-Hub-Delivery` | Unique ID for this delivery attempt. |
| `X-Family-Hub-Signature` | `sha256=<hex>` HMAC of the raw body using the subscription's secret. |
| `User-Agent` | `FamilyHub-Webhook/1`. |

### Signature verification (Node.js example)

```js
import { createHmac, timingSafeEqual } from "crypto";

function verify(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### Event types

#### `reminder.fired`

Fires when the reminder scheduler dispatches a reminder (event-derived,
maintenance, or manual).

```json
{
  "id": "ckxa…",
  "user_id": "ckxu…",
  "user_name": "Dan",
  "title": "Mow the lawn",
  "body": "Every 4 weeks. Lawn looks rough.",
  "remind_at": "2026-05-27T08:15:00.000Z",
  "source_event_reminder_id": null
}
```

#### `todo.created`

```json
{
  "id": "cktx…",
  "title": "Hang the washing",
  "description": null,
  "done": false,
  "due_at": "2026-05-27T18:00:00.000Z",
  "priority": 0,
  "created_by_id": "ckxu…",
  "assignee_id": "ckchild…",
  "category_id": "ckcat…",
  "points_reward": 5
}
```

#### `todo.completed`

Fires only when `done` flips `false → true`. Carries enough context for
HA to decide whether points were credited.

```json
{
  "id": "cktx…",
  "title": "Hang the washing",
  "description": null,
  "due_at": null,
  "completed_at": "2026-05-27T19:42:11.000Z",
  "completed_by_id": "ckchild…",
  "assignee_id": "ckchild…",
  "category_id": null,
  "points_reward": 5,
  "points_awarded": true
}
```

#### `event.created`

```json
{
  "id": "ckev…",
  "title": "Anniversary dinner",
  "description": "Reservation at Marco's",
  "start_at": "2026-05-31T19:00:00.000Z",
  "end_at": "2026-05-31T21:00:00.000Z",
  "all_day": false,
  "location": "Marco's",
  "starred": true,
  "recurring": false,
  "created_by_id": "ckxu…",
  "participant_user_ids": ["ckxu…", "ckpartner…"]
}
```

#### `event.starting`

Fires when an event (or recurring occurrence) reaches its start time.
Dedupe is keyed by `(event_id, start_at)` in memory, so a process
restart can in principle re-fire an event that just started — your
subscribers should be idempotent.

```json
{
  "event_id": "ckev…",
  "title": "Anniversary dinner",
  "description": "Reservation at Marco's",
  "location": "Marco's",
  "start_at": "2026-05-31T19:00:00.000Z",
  "end_at": "2026-05-31T21:00:00.000Z",
  "all_day": false,
  "recurring": false
}
```

#### `device.sleep_started`

Fires once when a kiosk (LocalDevice) enters its configured night-sleep
window. Edge-triggered server-side from the reminder-scheduler tick;
canonical use case is wiring this to Home Assistant's HDMI-CEC
integration to power the TV the kiosk is plugged into actually off.

```json
{
  "device_id": "ckdev…",
  "device_name": "Kitchen",
  "location": "Kitchen",
  "sleep_start": "22:00",
  "sleep_end": "07:00"
}
```

#### `device.sleep_ended`

Fires once when the kiosk's sleep window ends and it goes back to its
normal awake state. Use this to power the TV back on (or whatever the
opposite-of-sleep action is for that screen).

```json
{
  "device_id": "ckdev…",
  "device_name": "Kitchen",
  "location": "Kitchen",
  "sleep_start": "22:00",
  "sleep_end": "07:00"
}
```

#### `test.ping`

Synthetic event produced only by the **Test** button on a webhook row.
Useful for verifying HA / n8n is receiving and validating the signature
before turning real events on. Body shape:

```json
{ "event": "test.ping", "message": "Family Hub webhook delivery test" }
```

## Recipe: HDMI-CEC TV control from Home Assistant

A common deployment is a Raspberry Pi plugged into a TV via HDMI, running
Family Hub in kiosk-mode Chromium. Without CEC the TV stays on at full
backlight 24/7. Wiring it up:

1. In Home Assistant, install the
   [HDMI-CEC integration](https://www.home-assistant.io/integrations/hdmi_cec/)
   on the same Pi. Confirm `service: hdmi_cec.turn_off` powers your TV off.

2. In Family Hub, **Settings → Integrations → New webhook**. Point the URL
   at HA's incoming webhook URL (set up via HA's webhook automation
   trigger). Subscribe to both `device.sleep_started` and `device.sleep_ended`.

3. In HA's `automations.yaml`, drop in something like:

```yaml
- alias: "Kitchen TV — sleep with Family Hub"
  trigger:
    - platform: webhook
      webhook_id: family_hub_kitchen
  condition:
    # If you have multiple kiosks subscribed to the same webhook, branch on
    # device_name (or device_id) so you only act on the right TV.
    - condition: template
      value_template: "{{ trigger.json.data.device_name == 'Kitchen' }}"
  action:
    - choose:
        - conditions:
            - condition: template
              value_template: "{{ trigger.json.event == 'device.sleep_started' }}"
          sequence:
            - service: hdmi_cec.turn_off
              data: { entity_id: switch.kitchen_tv }
        - conditions:
            - condition: template
              value_template: "{{ trigger.json.event == 'device.sleep_ended' }}"
          sequence:
            - service: hdmi_cec.turn_on
              data: { entity_id: switch.kitchen_tv }
```

The same pattern works with other Home Assistant integrations (Wake-on-LAN,
IR blaster, smart-plug) — anywhere HA can power-cycle the screen, the
two webhook events are enough to drive it.

## Stability promise

The event-type strings and the field names inside `data` are part of the
public contract. Family Hub may **add** new event types or new fields to
existing payloads without bumping the API version, but it will not rename
or remove existing ones outside of a major version bump.

Endpoint paths under `/api/v1/` follow the same rule: additive changes
only until a future `/api/v2/` ships.
