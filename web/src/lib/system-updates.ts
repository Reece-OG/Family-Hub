/**
 * Thin wrapper around the /var/lib/family-hub/state/ directory that the
 * LXC installer's systemd units write into.
 *
 * See Family-Hub-LXC/state-helper.sh for the producer side of these files:
 *   - version.json        (written by `state-helper.sh check`)
 *   - update-status.json  (written by `state-helper.sh update`)
 *
 * The app never shells out to git / docker / systemctl itself. Instead it
 * touches two sentinel files:
 *   - check-requested    -> fires family-hub-check.path  -> state-helper check
 *   - update-requested   -> fires family-hub-update.path -> state-helper update
 *
 * If the state directory doesn't exist (e.g. a bare docker-compose install
 * without the Family-Hub-LXC installer, or running under `npm run dev`), the
 * read helpers return null and the request helpers throw so the API route
 * can surface a friendly "updates only available on the LXC installer"
 * message.
 */
import { promises as fs } from "fs";
import path from "path";

const STATE_DIR = process.env.FAMILY_HUB_STATE_DIR || "/var/lib/family-hub/state";
const VERSION_FILE = path.join(STATE_DIR, "version.json");
const UPDATE_STATUS_FILE = path.join(STATE_DIR, "update-status.json");
const CHECK_TRIGGER = path.join(STATE_DIR, "check-requested");
const UPDATE_TRIGGER = path.join(STATE_DIR, "update-requested");

export type VersionInfo = {
  branch: string;
  localSha: string;
  localShaShort: string;
  remoteSha: string;
  remoteShaShort: string;
  version: string;
  updateAvailable: boolean;
  commitsBehind: number;
  checkedAt: string;
  error: string | null;
};

export type UpdateStatus = {
  state: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

/**
 * True when the state dir (bind-mounted from the LXC host) is reachable.
 * We treat "no state dir" as "updater not installed" rather than an error.
 */
export async function isUpdaterAvailable(): Promise<boolean> {
  try {
    const st = await fs.stat(STATE_DIR);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    // Malformed JSON or permission error: log and return null so the UI can
    // show a "check failed" state rather than crashing.
    // eslint-disable-next-line no-console
    console.warn(`[system-updates] failed to read ${file}:`, err);
    return null;
  }
}

export async function getVersionInfo(): Promise<VersionInfo | null> {
  return readJsonSafe<VersionInfo>(VERSION_FILE);
}

export async function getUpdateStatus(): Promise<UpdateStatus | null> {
  return readJsonSafe<UpdateStatus>(UPDATE_STATUS_FILE);
}

async function touchTrigger(file: string): Promise<void> {
  const available = await isUpdaterAvailable();
  if (!available) {
    throw new Error(
      "In-app updates are only available on Family-Hub-LXC installs. The state directory is not mounted.",
    );
  }
  // Create-or-update mtime. Opening with "a" + closing is equivalent to
  // `touch` on a POSIX filesystem and fires systemd's PathChanged watcher.
  const fh = await fs.open(file, "a");
  await fh.close();
  const now = new Date();
  await fs.utimes(file, now, now);
}

/** Touch the sentinel that makes systemd fire state-helper.sh check. */
export async function requestCheck(): Promise<void> {
  await touchTrigger(CHECK_TRIGGER);
}

/** Touch the sentinel that makes systemd fire state-helper.sh update. */
export async function requestUpdate(): Promise<void> {
  await touchTrigger(UPDATE_TRIGGER);
}
