import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";
import { getClientIp, isLocalNetworkIp } from "@/lib/network";

const PUBLIC_PATHS = new Set<string>(["/login"]);
const PUBLIC_API = [
  "/api/auth/login",
  "/api/auth/logout",
  // v4.7 — device login endpoint is public (it does its own local-IP check).
  "/api/auth/device-login",
];
const COOKIE = "familyhub_session";

interface DeviceClaims extends JWTPayload {
  did?: string;
}

async function verifyToken(token: string): Promise<DeviceClaims | null> {
  const raw = process.env.AUTH_SECRET;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(raw),
      { algorithms: ["HS256"] },
    );
    return payload as DeviceClaims;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // v4.8.2 — surface the current pathname to RSC layouts via a request
  // header. The (app) layout reads it via headers() and uses it to enforce
  // the module-visibility hide list (Edge runtime can't touch Prisma, so
  // the check has to happen in the layout, but layouts can't see the URL
  // without this nudge).
  const downstreamHeaders = new Headers(req.headers);
  downstreamHeaders.set("x-pathname", pathname);
  const passthrough = () =>
    NextResponse.next({ request: { headers: downstreamHeaders } });

  // Allow next internals and static
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/assets") ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest"
  ) {
    return passthrough();
  }

  const token = req.cookies.get(COOKIE)?.value;
  const claims = token ? await verifyToken(token) : null;
  const authed = !!claims;

  // v4.7 — device sessions must originate from a local-network client. If a
  // device cookie shows up from outside the home LAN, treat it as
  // unauthenticated and clear the cookie. Email sessions are unaffected.
  if (claims?.did) {
    const ip = getClientIp(req);
    if (!isLocalNetworkIp(ip)) {
      const res = pathname.startsWith("/api/")
        ? NextResponse.json(
            {
              error:
                "Device session blocked: client IP is not on the local network.",
            },
            { status: 403 },
          )
        : NextResponse.redirect(new URL("/login?reason=offnet", req.url));
      // Clear the now-invalid cookie so the user can fall back to email login.
      res.cookies.set({ name: COOKIE, value: "", path: "/", maxAge: 0 });
      return res;
    }
  }

  // Public API endpoints
  if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return passthrough();
  }

  // v4.9.0 — /api/v1/* is the public bearer-token surface. Skip the
  // session-cookie auth and let the route handler validate the token
  // itself (lib/api-auth.ts → requireApiToken). The route handler also
  // owns the 401 / 403 response shape, so we don't pre-empt with our
  // session 401.
  if (pathname.startsWith("/api/v1/")) {
    return passthrough();
  }

  // API routes require auth
  if (pathname.startsWith("/api/")) {
    if (!authed) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return passthrough();
  }

  // Public pages
  if (PUBLIC_PATHS.has(pathname)) {
    if (authed && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return passthrough();
  }

  // Everything else requires auth
  if (!authed) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Landing page → dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return passthrough();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
