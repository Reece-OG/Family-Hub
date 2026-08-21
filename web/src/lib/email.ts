// Thin wrapper around nodemailer that pulls SMTP config from the AppSettings
// singleton. If SMTP isn't configured, sendEmail() is a no-op that returns
// {skipped: true} so callers don't have to handle the disabled case.

import nodemailer from "nodemailer";
import { prisma } from "./prisma";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendEmailResult {
  skipped?: boolean;
  accepted?: string[];
  messageId?: string;
}

// Cache the transporter for the lifetime of the process. When settings
// change, we invalidate via resetEmailTransporter().
let cached:
  | {
      transporter: nodemailer.Transporter;
      from: string;
    }
  | null = null;

export function resetEmailTransporter() {
  cached = null;
}

async function getTransporter() {
  if (cached) return cached;
  const s = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!s || !s.smtpHost || !s.smtpPort || !s.smtpFrom) return null;
  const transporter = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth:
      s.smtpUser && s.smtpPass
        ? { user: s.smtpUser, pass: s.smtpPass }
        : undefined,
  });
  cached = { transporter, from: s.smtpFrom };
  return cached;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const t = await getTransporter();
  if (!t) return { skipped: true };
  const info = await t.transporter.sendMail({
    from: t.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return { accepted: info.accepted as string[], messageId: info.messageId };
}

// Verify SMTP config without actually sending a message. Returns true if the
// SMTP server accepts the login + EHLO handshake, false otherwise.
export async function verifyEmailConfig(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const t = await getTransporter();
  if (!t) return { ok: false, error: "SMTP not configured" };
  try {
    await t.transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
