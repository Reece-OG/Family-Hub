# Family Hub — Docker install tutorial

This walks you end-to-end through getting Family Hub running in Docker.
Two paths are covered:

  * **Path A — LXC on Proxmox (recommended).** The helper script provisions
    a Debian LXC for you, installs Docker inside it, and brings the app up
    with a single command. Push notifications, the in-app updater and
    automatic Postgres backups all "just work" out of the box.
  * **Path B — Plain Docker host.** Use this when you already have a Linux
    server (a NUC, a NAS, a VPS, a Raspberry Pi, etc.) and just want to run
    `docker compose up -d` against the repo. No LXC required.

Pick whichever fits — both end at the same login screen, both can be
backed up + restored to each other, and both follow the same upgrade
path going forward.

---

## Before you start

You need:

  * A host machine with at least **1 GB free RAM** and **5 GB free disk**.
    Family Hub itself is tiny; photos / uploads / Postgres dominate the
    disk over time.
  * **HTTPS access** to the app from the devices you want to receive push
    notifications on. Web Push refuses to register on plain HTTP. You'll
    get this for free if you put the app behind a Cloudflare Tunnel, a
    reverse proxy with Caddy / Nginx, or just visit it from `localhost`
    while testing.
  * (For Path A) A working Proxmox VE 8.x or 9.x host with internet
    access and at least one storage you can put the LXC's rootfs on.
  * (For Path B) Docker Engine 24+ with Compose v2. Check with
    `docker --version` and `docker compose version`. If you only have
    `docker-compose` (the old v1 binary), upgrade — the v2 plugin syntax
    is what the repo uses.

> Family Hub is rebrandable. Anywhere these instructions say "Family Hub",
> you can set `APP_NAME=YourHub` in `.env` and the nav, login screen,
> browser tab, reminder emails and PDF headers all follow along.

---

## Path A — LXC on Proxmox (the easy path)

This is what most home users want. The helper script does all the
plumbing: creates the LXC, installs Docker + Postgres + the app, sets up
the systemd path units for the in-app updater, configures push, and
prints you a URL.

### Step 1 — Run the installer

SSH into your Proxmox host (or open its shell from the web UI) and run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Reece-OG/Family-Hub-LXC/main/install.sh)"
```

The installer is interactive. When it asks `native or docker?`, pick
**docker**. You'll then be prompted for:

  * **Container ID** — any unused CT number. The installer will check
    `/etc/pve/lxc/` and refuse to clobber an existing CT.
  * **Hostname** — whatever you want (e.g. `family-hub`).
  * **Storage** — pick from the list it prints. Local storage is fine
    for a home install. `local-lvm` is the typical default.
  * **Disk size** — 8 GB is comfortable for a year or two of light use;
    bump to 20 GB or more if you'll be uploading a lot of photos.
  * **Memory** — 1024 MB minimum, 2048 MB recommended.
  * **Network** — DHCP is fine for almost everyone. If you want a static
    IP, the installer will accept `192.168.1.50/24,gw=192.168.1.1` style
    syntax.
  * **Repo auth** — choose **HTTPS + GitHub PAT** (easiest) or **SSH +
    deploy key**. The installer will paste the PAT into a `.git-credentials`
    file inside the CT so future `update.sh` runs work without
    re-authentication.

The installer downloads the Debian 13 template if it's not already
present, creates the CT, installs Docker + Docker Compose inside it,
clones the Family Hub repo into `/opt/family-hub/`, generates a fresh
`AUTH_SECRET`, brings up the Postgres + web containers via
`docker compose up -d`, and prints something like:

```
==========================================
 Family Hub is up and running.
 Open: http://192.168.1.50:3000
 Login: parent@example.com / changeme
==========================================
```

### Step 2 — First login

Open the URL in a browser, log in as `parent@example.com` with password
`changeme`. The app immediately bounces you to a setup screen — it
**will not let you do anything else** until you change those credentials.
Pick a real name, email, and password.

### Step 3 — Add your family

Click **Family** in the sidebar. Use the **Add member** button to add
each child (and any other parents). Set each child's permissions
(view/edit calendar, todos, shopping, etc.) on the same page.

### Step 4 — Enable push notifications (optional but recommended)

On any device that supports Web Push, an amber banner appears at the
top of the app: *"Get reminders even when this app is closed."* Tap
**Enable**, accept the OS permission prompt, and the device is
registered. Reminders will now fire on the lock screen even when Family
Hub isn't open.

iOS-specific: Safari only supports Web Push for PWAs installed to the
home screen. Open Family Hub in Safari, tap the **Share** button → **Add
to Home Screen**, launch it from the icon, then tap **Enable** on the
banner.

### Step 5 — Future updates

The in-app updater is already wired up. Open **Settings → System** and
you'll see your installed version + a *Check for updates* button. Hit
**Update now** whenever a new release lands. The daily auto-check timer
pings GitHub once a day so the badge is already showing by the time you
look.

---

## Path B — Plain Docker host

For when you'd rather not run a separate LXC and just want to add
Family Hub to an existing Docker host (NAS, VPS, Pi, mini-PC, …).

### Step 1 — Clone the repo

```bash
git clone https://github.com/Reece-OG/Family-Hub.git
cd Family-Hub
```

### Step 2 — Configure environment

Family Hub ships a `.env.example`. Copy it:

```bash
cp web/.env.example web/.env
```

Edit `web/.env` in your favourite editor. The fields you must set:

| Variable | What it does |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. The default points at the `db` service in the bundled `docker-compose.yml`, so you don't need to change it unless you're pointing at an external Postgres. |
| `AUTH_SECRET` | A long random string used to sign session cookies. Generate one with `openssl rand -hex 32` and paste it in. |
| `APP_NAME` | The brand name shown in nav / login / emails / PDFs. Defaults to `Family Hub`. Set to whatever your family wants — `ReeceHub`, `SimpsonHub`, `HomeBase`, …. |
| `NEXT_PUBLIC_APP_NAME` | Same value as `APP_NAME`. Baked into the client bundle at build time. |
| `COOKIE_SECURE` | Leave `false` for plain-HTTP LAN testing. Set `true` once the app is behind HTTPS (Cloudflare Tunnel, Caddy, Nginx, etc.) — without this, browsers silently drop the session cookie on HTTPS and login appears to "succeed then bounce back to login". |

Optional fields you'll likely tweak later from the **Settings** page
inside the app rather than touching `.env`:

  * SMTP host/port/user/password for reminder emails.
  * Time zone (defaults to `Europe/London`).
  * Country code (drives the holidays auto-sync).
  * Weather location + provider.

> **Web Push VAPID keys are NOT in `.env`.** They're generated on the
> first request to `/api/push/vapid-key` and stored on the AppSettings
> singleton row. So push works out of the box with no install-time
> configuration.

### Step 3 — Bring it up

From the repo root:

```bash
docker compose up -d --build
```

Compose builds the Next.js image, pulls Postgres 16, starts both
containers, runs the Prisma migrations against the fresh DB on first
boot, and seeds the bootstrap parent account. First build takes 2–4
minutes; subsequent updates take seconds because Docker caches layers.

Check it's healthy:

```bash
docker compose ps
docker compose logs -f web
```

You should see:

```
NAME                    STATUS              PORTS
familyhub-db-1          Up 30 seconds       5432/tcp
familyhub-web-1         Up 25 seconds       0.0.0.0:3000->3000/tcp
```

Open `http://<host>:3000` in a browser.

### Step 4 — First login

Same as Path A — `parent@example.com / changeme`, forced credential
change, add family members, enable push, etc.

### Step 5 — Putting HTTPS in front

Browsers refuse to register service workers (and therefore subscribe to
push) on plain HTTP unless the host is `localhost`. For a LAN-only
install where everyone hits `192.168.x.x:3000` directly, push won't
work. Three options:

  * **Cloudflare Tunnel.** Easiest. Install `cloudflared` on the host,
    `cloudflared tunnel login`, create a tunnel pointed at
    `http://localhost:3000`, set a DNS record on a domain you control.
    HTTPS terminates at Cloudflare's edge, the tunnel keeps your origin
    safely off the public internet, and push works immediately.
  * **Caddy reverse proxy with auto-LE.** Install Caddy, drop a
    `Caddyfile`:

    ```
    familyhub.yourdomain.com {
      reverse_proxy localhost:3000
    }
    ```

    Caddy provisions a Let's Encrypt cert automatically.
  * **Nginx with manual cert.** Get a cert from Let's Encrypt via
    `certbot`, point Nginx at it, `proxy_pass http://localhost:3000`. A
    bit more legwork; same end result.

Once HTTPS is up, set `COOKIE_SECURE=true` in `web/.env`, then
`docker compose up -d` to restart the web container with the new
setting. Login will now stick.

### Step 6 — Updates

Plain Docker hosts don't have the LXC's in-app updater (that's a
host-level systemd thing) — you update by pulling the repo and
rebuilding:

```bash
cd Family-Hub
git fetch --prune origin
git reset --hard origin/main
docker compose build
docker compose up -d
```

Postgres, the uploads volume and the `.env` file are all untouched.
First post-update load might take 5–10 seconds while Next.js boots its
new bundle.

---

## Recovery, backup & restore

The app has a built-in backup/restore that's the same on both paths:

  * **Settings → Backup & Export → Download backup** writes a single
    `.zip` containing every Prisma model row plus every uploaded file
    (photos, recipe images, receipts, reward images, maintenance
    docs). Drop that zip somewhere safe.
  * **Restore from backup** wipes the live DB + uploads and re-seeds from
    the zip. There's a typed `RESTORE` confirm to stop you doing it by
    accident.
  * **Download family PDF** is a separate take-it-with-you document for
    people leaving the app — every family-facing thing as printable A4.

If the restore button doesn't work (very large backups can hit the
upload size cap), bump the limit by setting `FAMILYHUB_RESTORE_MAX_MB`
in `web/.env` and restarting the web container.

---

## Troubleshooting

### "Compiled successfully ... Failed to compile" after an update

Almost always a Next.js type-check error caused by a transitive dep
that uses Node-only modules (`net`, `http`, `https`, `fs`) being
reachable from `instrumentation.ts`. The repo's `next.config.js` already
externalises the usual suspects (`pdfkit`, `nodemailer`, `web-push`,
`adm-zip`); if a new one creeps in, add it to both
`experimental.serverComponentsExternalPackages` and the webpack
`externals` callback's `NODE_ONLY` list.

### "Module not found: Can't resolve 'net'" (or 'http' / 'https' / 'tls') on the Edge build

Edge runtime can't resolve Node built-ins. Either:

  * Add the offending package to `next.config.js`'s `NODE_ONLY` list, **and**
  * Confirm `next.config.js` has `config.resolve.fallback = { net: false,
    http: false, https: false, … }` when `nextRuntime === "edge"`.

The repo ships with this already configured — only worth checking if
you've forked or modified `next.config.js`.

### Login appears to succeed but immediately bounces back to the login screen

The session cookie was silently dropped because:

  * `COOKIE_SECURE=true` is set but you're hitting plain HTTP (`http://`).
    Either turn off `COOKIE_SECURE` for local testing or put HTTPS in
    front.
  * Or the system clock on the host is wildly off (>30 days), making the
    issued JWT instantly expire. Fix with `timedatectl set-ntp true`.

### Push notifications never fire even though the banner says enrolled

  * Check **Settings → Notifications** — is your device in the list?
  * Hit **Send test push**. If it says "delivered 0", the subscription
    didn't actually land; re-enrol via the banner or the Enable button.
  * If "delivered 1" but the device never beeps, check the browser's
    notification permission for the site (Chrome: padlock → Site
    settings → Notifications). iOS specifically: push only works for
    PWAs installed to the home screen, not Safari tabs.
  * VAPID keys live on the `AppSettings` singleton — if you `prisma db
    push` against a fresh DB you'll need to re-enrol every device since
    the new VAPID identity invalidates old subscriptions.

### In-app updater fails with "Not possible to fast-forward, aborting"

You're on a pre-v4.7.2 install whose `update.sh` does `git pull
--ff-only`. Patch it once:

```bash
pct exec <ctid> -- sed -i '/^do_git_pull/c\do_git_pull()       { sudo -u "$SERVICE_USER" bash -lc "cd $INSTALL_DIR \&\& git fetch --prune origin \&\& git reset --hard origin/main"; }' /opt/family-hub/update.sh
```

If `do_git_pull` is a multi-line function (early installs were), use
the migrate script which handles both forms:

```bash
pct exec <ctid> -- bash -c "$(curl -fsSL https://raw.githubusercontent.com/Reece-OG/Family-Hub-LXC/main/migrate-to-4.7.2.sh)"
```

### `docker compose up -d` exits immediately with no obvious error

Run `docker compose logs db` and `docker compose logs web` separately —
one of them is silently bailing. Common cause: the Postgres data
directory survived a previous failed install and is initialised with
different auth than the current `.env`. Wipe it:

```bash
docker compose down --volumes
docker compose up -d --build
```

(Only do this on a fresh install — `--volumes` deletes the Postgres
data.)

---

## What's next

  * Set up your family on the Family page.
  * Open **Settings → Email** and configure SMTP if you want email
    reminders.
  * Open **Settings → Weather** and pick a location for the dashboard +
    screensaver widgets.
  * Open **Settings → Financial Year** and pick AU / US / UK / NZ if you'll
    be using My Taxes.
  * Stick a phone or tablet in the kitchen with the screensaver enabled
    (Settings → Local Devices → Add device → tick "Use screensaver") and
    you've got a permanently-on family dashboard.
  * Schedule a backup on your calendar — the family export PDF takes
    seconds to generate and is a great safety net you can drop on a USB
    stick.

If anything in this tutorial is wrong or unclear, open an issue on the
repo and I'll fix it.
