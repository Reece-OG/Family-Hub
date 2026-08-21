// v4.7 — helpers for figuring out the client's IP and deciding whether it
// counts as "on the local network" for device-login enforcement.
//
// We treat the following as local:
//   - IPv4 loopback           127.0.0.0/8
//   - IPv4 private space      10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
//   - IPv4 link-local         169.254.0.0/16
//   - IPv6 loopback / ULA / link-local  ::1, fc00::/7, fe80::/10
//   - IPv4-mapped IPv6 forms (::ffff:10.0.0.1) — unwrapped before testing
//
// The opt-out env var FAMILYHUB_TRUST_ALL_IPS=1 lets advanced operators bind
// the device login to a non-local interface (useful for VPN scenarios where
// "the home network" comes via a VPN tunnel that doesn't expose a private IP
// on the request side). Off by default — devices are local-only as the user
// asked.

import type { NextRequest } from "next/server";

export function getClientIp(req: NextRequest): string | null {
  // Standard reverse-proxy header. Take the first hop (the original client).
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return stripIpv4Mapped(first);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return stripIpv4Mapped(real.trim());
  // NextRequest exposes .ip on Vercel + edge runtime; cast through unknown to
  // keep the type-checker happy in Node runtime where it isn't typed.
  const direct = (req as unknown as { ip?: string }).ip;
  if (direct) return stripIpv4Mapped(direct);
  return null;
}

function stripIpv4Mapped(addr: string): string {
  // ::ffff:1.2.3.4  →  1.2.3.4
  const m = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  return m ? m[1] : addr;
}

export function isLocalNetworkIp(addr: string | null): boolean {
  if (!addr) return false;
  if (process.env.FAMILYHUB_TRUST_ALL_IPS === "1") return true;
  const ip = stripIpv4Mapped(addr.trim());

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    const parts = ip.split(".").map((n) => Number(n));
    if (parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    if (a === 127) return true;                 // loopback
    if (a === 10) return true;                  // 10.0.0.0/8
    if (a === 192 && b === 168) return true;    // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true;    // link-local
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;             // loopback
  if (lower.startsWith("fe80:")) return true;   // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  return false;
}
