// Branding — resolve once from env at import time.
//
// Order of precedence:
//   1. NEXT_PUBLIC_APP_NAME  — available in both server and client code, so a
//      single build can brand every surface consistently (nav, login, titles).
//   2. APP_NAME              — server-only fallback, handy when operators set
//      just one var and don't want to worry about the NEXT_PUBLIC_ prefix.
//   3. "Family Hub"          — ship default so things still render if the var
//      is missing.

const DEFAULT_NAME = "Family Hub";

function normalize(v: string | undefined | null): string {
  if (!v) return "";
  const trimmed = v.trim();
  return trimmed;
}

export const APP_NAME: string =
  normalize(process.env.NEXT_PUBLIC_APP_NAME) ||
  normalize(process.env.APP_NAME) ||
  DEFAULT_NAME;
