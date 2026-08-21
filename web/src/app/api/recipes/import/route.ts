import { NextResponse } from "next/server";

// Recipe import was removed in v4.4 — export switched to PDF, so the
// round-trip JSON shape no longer makes sense. This handler is kept only so
// older clients that still hit the URL see a clear explanation instead of a
// cryptic 404.

export async function POST() {
  return NextResponse.json(
    { error: "Recipe import was removed in v4.4." },
    { status: 410 },
  );
}
