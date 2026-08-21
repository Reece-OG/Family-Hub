import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  getCurrentUser,
  setSessionCookie,
} from "@/lib/auth";

// One-shot account setup for the bootstrap parent account. Only accepts
// writes while the signed-in user still has `mustChangeCredentials` set —
// once they've saved new details the flag clears and this endpoint becomes
// a no-op for future requests.
const schema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 },
      );
    }
    if (!me.mustChangeCredentials) {
      // Setup already complete — don't allow this endpoint to become a
      // backdoor credential-change path for normal users.
      return NextResponse.json(
        { error: "Setup already completed." },
        { status: 409 },
      );
    }

    const body = await req.json();
    const { name, email, password } = schema.parse(body);
    const newEmail = email.toLowerCase();

    // Block collisions with other accounts — e.g. an admin who's already
    // created their personal User from the Family page.
    if (newEmail !== me.email) {
      const clash = await prisma.user.findUnique({
        where: { email: newEmail },
      });
      if (clash) {
        return NextResponse.json(
          { error: "That email is already in use." },
          { status: 409 },
        );
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await prisma.user.update({
      where: { id: me.id },
      data: {
        name,
        email: newEmail,
        passwordHash,
        mustChangeCredentials: false,
      },
    });

    // Rotate the session cookie so the JWT claims reflect the new email /
    // name immediately. Without this, the old parent@example.com still
    // appears in layouts until the next full page reload.
    const token = await createSessionToken(
      updated.id,
      updated.role,
      updated.email,
      updated.name,
    );
    setSessionCookie(token);

    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    console.error(e);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
