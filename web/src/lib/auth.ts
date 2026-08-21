import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "./prisma";

const COOKIE_NAME = "familyhub_session";
const SESSION_DAYS = 30;

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "AUTH_SECRET is not configured (must be a long random string)."
    );
  }
  return new TextEncoder().encode(raw);
}

export interface SessionPayload extends JWTPayload {
  sub: string; // user id (always a real User.id, even for device sessions)
  role: "PARENT" | "CHILD";
  email: string;
  name: string;

  // v4.7 — present only on device sessions. Carries the kiosk device
  // identity + per-device screensaver preference so downstream code can
  // gate behaviour without re-reading the DB on every render.
  did?: string;  // LocalDevice.id
  dname?: string; // device display name
  dloc?: string;  // device location
  dscreen?: boolean; // useScreensaver
}

// Shared option bag for both user- and device-session JWTs.
async function signToken(
  userId: string,
  extras: Omit<SessionPayload, "sub" | "iat" | "exp">,
): Promise<string> {
  return await new SignJWT(extras as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret());
}

export async function createSessionToken(
  userId: string,
  role: "PARENT" | "CHILD",
  email: string,
  name: string
): Promise<string> {
  return await signToken(userId, { role, email, name });
}

// v4.7 — device session issued by the device-login endpoint. `userId` is the
// User the device acts as; the extra device claims carry the kiosk identity.
export async function createDeviceSessionToken(args: {
  userId: string;
  role: "PARENT" | "CHILD";
  email: string;
  userName: string;
  deviceId: string;
  deviceName: string;
  deviceLocation: string;
  useScreensaver: boolean;
}): Promise<string> {
  return await signToken(args.userId, {
    role: args.role,
    email: args.email,
    name: args.userName,
    did: args.deviceId,
    dname: args.deviceName,
    dloc: args.deviceLocation,
    dscreen: args.useScreensaver,
  });
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

// Most self-hosted Family Hub deployments sit on a LAN and are reached over
// plain HTTP (e.g. http://family-hub.local:3000). A `Secure` cookie is
// silently dropped by the browser on such a connection, which looks exactly
// like "login succeeds then bounces back to the login screen." So instead
// of gating on NODE_ENV=production (which is always true in real deploys),
// opt in via COOKIE_SECURE=true — only set when the app is reached over
// HTTPS (typically via a reverse proxy like Caddy / Nginx / Cloudflare).
function cookieSecure(): boolean {
  const raw = (process.env.COOKIE_SECURE ?? "").toLowerCase().trim();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function setSessionCookie(token: string) {
  // v5.0.4 — set BOTH Max-Age and Expires. iOS Safari (especially in
  // "Add to Home Screen" PWA mode) has historically treated cookies
  // carrying only Max-Age as session cookies and cleared them when the
  // app is closed. Chromium and Firefox happily respect Max-Age alone;
  // Safari respects either but is more reliable with an explicit
  // Expires. Sending both means every mainstream browser sees the same
  // 30-day expiry regardless of which attribute it prefers.
  const maxAgeSeconds = SESSION_DAYS * 24 * 60 * 60;
  cookies().set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: maxAgeSeconds,
    expires: new Date(Date.now() + maxAgeSeconds * 1000),
  });
}

export function clearSessionCookie() {
  // Mirror the belt-and-braces from setSessionCookie: set Max-Age=0 AND
  // Expires in the past. Anything that respected the persistence Expires
  // from the login response will now respect the invalidation Expires
  // from logout.
  cookies().set({
    name: COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifySessionToken(token);
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "Not authenticated");
  return s;
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { permissions: true },
  });
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Not authenticated");
  return user;
}

export async function requireParent() {
  const user = await requireUser();
  if (user.role !== "PARENT") throw new HttpError(403, "Parent access only");
  return user;
}

// v4.7 — returns the kiosk device context if the current session is a device
// session; null for regular email logins. Cheap (reads JWT claims only, no DB
// lookup) — call freely from server components / layout.
export async function getCurrentDevice(): Promise<{
  id: string;
  name: string;
  location: string;
  useScreensaver: boolean;
} | null> {
  const session = await getSession();
  if (!session?.did) return null;
  return {
    id: session.did,
    name: session.dname ?? "",
    location: session.dloc ?? "",
    useScreensaver: Boolean(session.dscreen),
  };
}

// v4.7.4 — used by My Taxes (and any future "private to me" feature) to
// reject kiosk sessions outright. Receipts must never be visible on a
// shared screen, so we deny at the API boundary rather than hoping the
// client-side hide is sufficient.
export async function requirePrivateUser() {
  const user = await requireUser();
  const session = await getSession();
  if (session?.did) {
    throw new HttpError(403, "Not available on shared device sessions");
  }
  return user;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
