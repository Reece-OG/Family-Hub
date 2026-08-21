# Family Hub

![Version](https://img.shields.io/badge/version-5.0.7-blue)
![License](https://img.shields.io/badge/license-AGPLv3-green)
![Docker Compose](https://img.shields.io/badge/docker--compose-supported-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)
![Built with Claude](https://img.shields.io/badge/built%20with-Claude%20AI-7c3aed)

A self-hosted home & family dashboard. One installation gives the whole household a shared calendar, to-do lists, shopping lists, meal planning, recipe book, photo screensaver, maintenance log, points-based chores + rewards, private tax record-keeping, push notifications, and a take-it-with-you PDF export — all running on your own LXC, mini-PC or NAS.

Rebrandable: set `APP_NAME=ReeceHub` (or `SimpsonHub`, `HomeBase`, …) in `.env` and the nav, login screen, browser tab, reminder emails and PDF headers all follow along.

* * *

## Screenshots

### Login & Home

![Login page](.github/images/login.png)

![Home dashboard](.github/images/dashboard.png)

### Calendar

![Month view](.github/images/calendar-month.png)

![Week view](.github/images/calendar-week.png)

![Event dialog](.github/images/calendar-event-dialog.png)

### To-dos & Shopping

![To-do list with categories and points reward chips](.github/images/todos.png)

![Shopping list grouped by aisle](.github/images/shopping.png)

### Menu & Recipes

![Weekly menu planner](.github/images/menu.png)

![Recipe detail with Cook Mode toggle](.github/images/recipe-detail.png)

### Birthdays & Reminders

![Birthdays tab](.github/images/birthdays.png)

![Reminders inbox](.github/images/reminders.png)

### Rewards

![Per-child points ledger](.github/images/rewards-ledger.png)

![Reward catalogue](.github/images/rewards-catalog.png)

![Ready-to-fulfil queue (parent view)](.github/images/rewards-fulfil.png)

### My Taxes (private, per user)

![Tax receipts grouped by FY](.github/images/taxes.png)

### Maintenance

![Vehicles, appliances and tools with service intervals](.github/images/maintenance.png)

### Photos & Screensaver

![Photos library](.github/images/photos.png)

![Kitchen-display screensaver](.github/images/screensaver.png)

### Settings

![Backup, restore, family PDF and in-app updates](.github/images/settings-system.png)

* * *

## Features

### Authentication & Roles

*   Email + password (bcrypt-hashed) with JWT session cookie.
*   **Parent** and **Child** roles. Parents have full access; each child's view/edit access is controlled by a per-feature permission tickbox panel.
*   First-run guard: bootstrap admin (`parent@example.com` / `changeme`) is forced to set real credentials before they can use the app.
*   Animated paint-splash login screen.

### Calendar

*   Day / Week / Month views with a live "now" indicator and drag-to-create.
*   Recurring events (daily / weekly / monthly / yearly, custom interval, weekday picker, end-after-N or end-on-date).
*   Per-event reminders with configurable lead time + delivery channels.
*   Starred events tab for important items.
*   Public-holiday auto-sync via the free [Nager.Date](https://date.nager.at) API for the configured country, cached in Postgres and resyncable from settings.
*   **Viewport-scaled month grid** — cells expand to fill the available height on big screens (kiosks!) but stay compact on phones.

### To-dos

*   Shared list with optional assignee, due date, recurrence, priority and category.
*   Recurring to-dos automatically roll a fresh next instance forward when ticked done.
*   Optional **Show on calendar** toggle anchors the to-do to its `dueAt` on the calendar grid.
*   Parents can attach a **Points reward** that auto-credits the child assignee on completion.
*   "Mark done" and "Clear completed" are separate actions — ticked rows stay visible with a strikethrough until you explicitly clear them.

### Shopping list

*   Two tabs: **List** (the active shopping list) and **Catalog** (a reusable library of items you buy often).
*   List items grouped by category (Produce, Dairy, Pantry, …) with quantity and check-off.
*   Catalog masters store name, default quantity, and category — tap **+** to drop one onto the list in a single click. Sortable by category or most-recently-used; searchable.
*   "Clear ticked" toolbar action for the post-shop tidy-up.
*   PDF export of the current list.

### Menu & Recipes

*   Weekly meal planner (breakfast / lunch / dinner / snack), free-form entries or recipe references, multiple items per slot.
*   Recipe book with ingredients, instructions, servings, prep / cook minutes, calories, hero image upload, tags.
*   **Add ingredients to the shopping list straight from any recipe** — a primary "Add all" button on the header plus a `+` next to each individual ingredient. Items already on the open list are skipped automatically.
*   One-click "Build shopping list" pulls every ingredient out of the whole week's menu and adds it to the live shopping list.
*   Cookbook PDF export with embedded hero images.
*   **Cook Mode** keeps the kitchen kiosk awake while a recipe is open and pauses the in-app screensaver + night cover for the duration.

### Birthdays

*   Standalone Birthdays tab for friends and extended family in addition to family-member dates of birth.
*   Optional "year unknown" mode (hides age math).
*   Auto-creates a recurring all-day calendar event so birthdays show up on the calendar grid too.
*   Per-family-member opt-in to add the birthday to the shared calendar (defaults on; flip off per-person from Family).
*   Plain-text **Search Birthdays** box for quickly finding a name in a long list.

### Reminders & Push notifications

*   Per-user scheduled reminders with in-app toast and optional email delivery (SMTP).
*   Auto-spawned reminders from calendar events (N minutes before) and Maintenance items (next-service-due + registration / insurance expiry).
*   **Web Push** so reminders fire on the lock screen even when Family Hub is closed or backgrounded — Android Chrome, desktop Chrome / Edge / Firefox, and iOS 16.4+ once added to home screen.
*   **iOS-aware enrolment** — Safari running outside a PWA gets an explicit "Add to Home Screen first" card instead of silently failing.
*   Reminders go out with **urgency: high** and a TTL bounded to relevant timeframes so iOS / FCM don't defer them under low-power mode.
*   VAPID keys auto-generate on first run; dead subscriptions auto-prune on 410 Gone.
*   **Parent opt-in** in Settings → Notifications to receive a copy of every event reminder that fires on any of your children.
*   **Per-user reminder kill switch** in the family edit dialog — flip a child's event reminders off for a bedroom kiosk that shouldn't ding overnight.

### Rewards (earn + spend)

*   Award / deduct points on a child with a free-text reason; full per-child ledger.
*   Earn-by-completion: any to-do with `pointsReward > 0` auto-credits the assigned child when they tick it done.
*   **Catalogue** with parent-managed reward items (name, cost, description, optional image, available toggle, category).
*   Bundled starter categories (Cash, Sweets, Screen time, Privileges, Other) — fully editable.
*   **Redemption flow:** child taps Redeem → points deducted immediately → row enters PENDING → parent fulfils (delivers the reward) or cancels-with-refund.

### My Taxes (private, per user)

*   Strictly per-user — even another parent can't see your receipts. Hidden entirely on shared / kiosk sessions.
*   Upload receipts as PDF or image, hand-enter line items + amounts, tag each line by category.
*   Bundled ATO-style starter categories — Tools, Travel, Vehicle, Self-education, Home office, Phone & internet, Uniform & PPE, Union & professional fees, Donations, Other — all editable.
*   **Vehicle expenses auto-roll** in from any Maintenance item with `deviceType ∈ {Car, Motorbike}` for the financial year.
*   Family-wide financial-year window (AU / US / UK / NZ presets + custom).
*   Per-FY summary PDF export grouped by category with a Vehicle section.

### Maintenance log

*   Track vehicles, mowers, appliances, bikes, tools, etc. with service-interval reminders.
*   Per-item service-record log (date, work done, performer, cost) — the "Last serviced" date and "Next service due" recompute automatically.
*   Registration & insurance tracking (provider, policy number, expiry, document upload) with renewal nag-reminders 30 days out.
*   Parent-permission gated; hidden on kiosk / local-device sessions.

### Family sticky notes

*   "Fridge magnet" message board for the family — anyone signed in can post.
*   Sticky-paper aesthetic in yellow / pink / green / blue with a subtle deterministic tilt; pinned notes float to the top of the board.
*   Compact widget on the dashboard plus a dedicated **/notes** page for the full board.
*   Authors can edit, recolour and unpin their own notes; parents can clean up anyone's.

### Photos & Screensaver

*   Family photo uploads with captions, **multi-select drag-and-drop with per-file progress** (parallel uploads, 4 at a time).
*   **HEIC / HEIF accepted** so iPhone photos upload without manual conversion (stored byte-for-byte; Safari renders inline).
*   Idle-triggered full-screen photo slideshow on configured kiosks.
*   **Cross-fade transitions** between slides instead of a hard cut.
*   Optional shuffle, configurable slide interval, weather widget overlay (Open-Meteo or BOM).
*   Clock, date and weather banner are typographically matched as one strip across the top.
*   Per-device opt-in so phones / laptops never get hijacked into the slideshow.

### Local devices (kiosks)

*   Named kiosk logins ("Living Room", "Kitchen") restricted to the LAN by RFC1918 IP check.
*   Each kiosk acts as a chosen user — inherits their permissions.
*   Per-device screensaver opt-in + idle minutes.
*   Per-device night-sleep window with re-sleep idle so the screen goes black during configured hours.
*   Per-device **module hide list** (see below) for locking down what each shared screen exposes.

### Module visibility & kiosk lockdown

*   Hide whole modules app-wide from **Settings → App Modules** — e.g. switch off Rewards or Taxes if you don't use them. The nav entry disappears everywhere and direct-URL access redirects to the dashboard.
*   **Per-kiosk overrides** on each Local Device's edit dialog can hide additional modules just for that screen — a bedroom kiosk shows only Reminders + To-dos while the kitchen kiosk gets the full set.
*   Hide **Settings** from the kitchen kiosk so anyone walking up can't reconfigure the family. Dashboard, Family and Settings stay pinned for email sessions so you can't lock yourself out of the app.
*   Enforced server-side via middleware so direct-URL access to a hidden module redirects, not just the nav entry.

### Public REST API & webhooks

*   Read-only `/api/v1` surface for **events**, **todos**, **shopping** and **reminders** with bearer-token auth and scope strings (`events:read`, `todos:read`, …) or a wildcard `*` for trusted integrations.
*   **Outbound webhook subscriptions** push events (`reminder.fired`, `todo.created`, `todo.completed`, `event.created`, `event.starting`) to any URL — HMAC-SHA256 signed, retried on 5xx with 1s/5s/30s backoff, fire-and-forget so a slow subscriber can't wedge the app.
*   First-class **Home Assistant / n8n / Node-RED** integration target: flash a light when a reminder fires, log chore completions to InfluxDB, announce events on a smart speaker.
*   Self-service Settings → Integrations card to mint tokens, register webhooks, **Test** delivery and **Rotate** secrets — GitHub-PAT-style one-shot reveal.
*   Healthy / failing badge and last-error inline on each webhook row.
*   Full payload reference + Node signature-verification snippet in `docs/api.md`.

### Backup, restore & family export

*   **Download backup** — single ZIP containing every Prisma model + every uploaded photo / recipe image / receipt / reward image / maintenance doc. Disaster-recovery on a fresh install with zero external dependencies.
*   **Restore from backup** — typed-`RESTORE` confirm, then wipes-and-replaces. Restore order is settings → users → categories → mid-tier → events → birthdays → content → ledger so foreign keys are always satisfied.
*   **Download family PDF** — printable A4 take-it-with-you doc covering every family-facing model with embedded recipe and reward images. App settings deliberately excluded.

### In-app updates

*   Settings → System card shows installed version + short SHA.
*   **Check for updates** and **Update now** buttons run server-side via systemd path units (privilege-separated; the web app touches sentinel files, a root helper does the work).
*   Daily background `git fetch` so the "Update available" badge is ready when you open Settings.
*   Subtle **post-update modal** the next time you open the app, listing the new features since you last visited.
*   Works on both native and Docker installs of the [Family-Hub-LXC installer](https://github.com/Reece-OG/Family-Hub-LXC).

### Theming, PWA & mobile

*   Light / dark mode (system-aware, remembers user choice).
*   Installable PWA on iOS, Android and desktop.
*   Hand-written service worker with offline shell, hashed-asset cache, and Web Push handlers.
*   Mobile-first — bottom tab bar on phones, collapsible sidebar on desktop.
*   **Pull-to-refresh** on touch devices in standalone PWA mode.
*   **Auto-refresh** on every list view (To-dos, Shopping, Calendar, Menu, Reminders, …) so kiosks stay current without manual reloads — refreshes on tab focus and at 30-60s intervals while visible.
*   Cloudflare-Tunnel friendly — runs as a standard web app on port 3000.

* * *

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript |
| Styling | Tailwind CSS + `lucide-react` icons |
| State / data | React hooks + server fetch |
| Backend | Next.js Route Handlers (Node 20 runtime) |
| Database | PostgreSQL 16 |
| ORM | Prisma 5.22 |
| Auth | `bcryptjs` + JOSE JWT in `HttpOnly` cookie |
| Email | Nodemailer (SMTP) |
| PDF | `pdfkit` (recipes, taxes, family export) |
| Push | `web-push` 3.6 (VAPID, auto-generated on first run) |
| Backups | `adm-zip` |
| Service worker | hand-written `sw.js` (offline shell + push + notification-click) |
| Container | Docker Compose (Postgres + web app) |
| Installer | [Family-Hub-LXC](https://github.com/Reece-OG/Family-Hub-LXC) — Proxmox helper-script style, native or docker |

* * *

## Requirements

*   Docker Engine 24+ with Compose v2, **OR** Node 20 + a running Postgres 16 instance.
*   ~1 GB RAM and ~5 GB disk for a comfortable install. The container itself is small; uploads / photos dominate disk over time.
*   For Web Push: HTTPS access to the app (Cloudflare Tunnel, reverse proxy with TLS, or `localhost`). Browsers refuse to register service workers on plain HTTP.

* * *

## Quick deploy (Family-Hub-LXC, recommended)

The easiest path on a Proxmox host is the [Family-Hub-LXC](https://github.com/Reece-OG/Family-Hub-LXC) helper script. It builds an unprivileged Debian LXC, installs everything (Postgres, Node, Nginx-style reverse proxy, the in-app-update wiring), and seeds the bootstrap parent account.

From your Proxmox shell:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Reece-OG/Family-Hub-LXC/main/install.sh)"
```

Pick **native** or **docker** at the prompt. Once it finishes, the CT prints a URL — open it in a browser, sign in as `parent@example.com / changeme`, and the first-run flow forces you to set real credentials.

> **In-app updates** are wired up automatically. Open **Settings → System → Check for updates → Update now** any time a new release lands.

* * *

## Quick start (build from source)

If you want to run Family Hub on your own host without the LXC installer:

1.  Clone this repository:
    
    ```bash
    git clone https://github.com/Reece-OG/Family-Hub.git
    cd Family-Hub
    ```
    
2.  Copy and edit the environment file:
    
    ```bash
    cp web/.env.example web/.env
    # Edit web/.env — set DATABASE_URL, AUTH_SECRET, APP_NAME, etc.
    ```
    
3.  Bring it up with Docker Compose:
    
    ```bash
    docker compose up -d --build
    ```
    
4.  Open `http://<your-host>:3000` in a browser. Sign in as `parent@example.com / changeme` and the setup flow forces you to pick a real email + name + password.

> **Web Push** needs HTTPS to work end-to-end. For local testing, `http://localhost:3000` is fine (browsers exempt localhost). For a LAN install, put a reverse proxy with a TLS cert in front (Caddy / Nginx / Cloudflare Tunnel).

* * *

## Configuration reference

All configuration lives in `web/.env`. Most installs only need to touch `DATABASE_URL`, `AUTH_SECRET` and `APP_NAME`.

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://familyhub:familyhub@db:5432/familyhub` | Postgres connection string. |
| `AUTH_SECRET` | _(required)_ | Long random string used to sign JWT session cookies. |
| `COOKIE_SECURE` | `false` | Set to `true` when the app is reached over HTTPS. |
| `APP_NAME` | `Family Hub` | Brand name shown in nav, login screen, browser tab, emails and PDFs. |
| `NEXT_PUBLIC_APP_NAME` | _(mirrors `APP_NAME`)_ | Same value as above; baked into the client bundle at build time. |
| `UPLOADS_DIR` | `./uploads` | Where photos / recipe images / receipts / etc. land on disk. |
| `FAMILYHUB_RESTORE_MAX_MB` | `250` | Upload-size cap for backup restores. Bump if your photo library is huge. |

VAPID keys for Web Push are **not** in `.env` — they're generated on first request to `/api/push/vapid-key` and stored on the `AppSettings` singleton row, so push works out of the box without any install-time configuration.

Reminder email delivery is configured at runtime in **Settings → Email**, not via env, so you can rotate SMTP credentials without rebuilding the container.

* * *

## Updating

If you used the LXC installer, do nothing — the in-app updater handles it. **Settings → System → Check for updates → Update now**.

For a hand-rolled install:

1.  Pull the latest code:
    
    ```bash
    git fetch --prune origin
    git reset --hard origin/main
    ```
    
2.  Rebuild and restart:
    
    ```bash
    docker compose build
    docker compose up -d
    ```
    
    Postgres, the uploads volume, and any in-place customisations are unaffected.

* * *

## Project structure

```
.
├── README.md
├── docker-compose.yml          # web + postgres for local self-hosting
└── web/                        # Next.js app
    ├── prisma/
    │   └── schema.prisma       # all models in one file
    ├── public/
    │   ├── sw.js               # service worker: offline shell + push + notification-click
    │   ├── manifest.webmanifest
    │   └── …                   # icons, favicons
    └── src/
        ├── app/
        │   ├── (app)/          # auth-gated app shell (calendar, todos, recipes, …)
        │   ├── api/            # Route Handlers — auth, events, todos, photos, push, admin/backup, …
        │   ├── login/
        │   ├── setup/          # first-run credential change
        │   └── screensaver/    # full-screen kiosk slideshow (no nav chrome)
        ├── components/         # React UI components (Calendar, TodoList, RewardsView, …)
        └── lib/                # server-side helpers (auth, push, backup, family-pdf, …)
```

* * *

## Contributing

Pull requests welcome. Quick rules of the road:

1.  Open an issue first for anything bigger than a typo so we can agree on the shape before you write code.
2.  Keep migrations declarative — schema changes go through `prisma db push`; we don't ship `prisma/migrations/` so the install story stays a single command.
3.  Run `npm run lint` and `npx tsc --noEmit` from `web/` before opening the PR. The CI pipeline runs the full Next.js build.
4.  Bump `web/package.json`, `web/public/sw.js` `CACHE_VERSION`, and add a section to the relevant `Family-Hub-vX.Y.Z/` snapshot folder if your change ships a release.
5.  Be kind in PR review.

* * *

## License

Family Hub is licensed under the **GNU Affero General Public License v3.0**. See [LICENSE](LICENSE) for the full text.

### What this means

*   You can run it for your family, your friends' families, or your whole street — for free, forever.
*   You can modify it as much as you like.
*   If you redistribute it (including hosting a modified version for others to use), you have to make your modifications available under the same licence.

* * *

## AI assistance

Family Hub was built with significant assistance from [Claude](https://www.anthropic.com/claude) by Anthropic — schema design, route handlers, UI components, and most of the prose in this README. Every change is reviewed and tested by the project authors before it ships, but the heavy lifting on a feature this broad simply isn't realistic for one person without the help.

* * *

## Disclaimer

Family Hub is an independent project and is not affiliated with, endorsed by, or sponsored by any of the third-party services it integrates with (BOM, Open-Meteo, Nager.Date, Cloudflare, etc.). All trademarks belong to their respective owners.

This software is provided "as is", without warranty of any kind. You're running it yourself, on your own hardware, against your own family's data. Take backups (the [Backup, restore & family export](#backup-restore--family-export) feature exists for exactly this reason).
