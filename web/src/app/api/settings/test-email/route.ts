import { NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { sendEmail, verifyEmailConfig, resetEmailTransporter } from "@/lib/email";
import { APP_NAME } from "@/lib/app-name";

// Parent-only. Verifies the SMTP handshake and sends a one-off test email to
// the parent's own address so they can confirm reminders will work end-to-end.
export async function POST() {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can test SMTP");
    }
    // Always use the latest settings.
    resetEmailTransporter();
    const verify = await verifyEmailConfig();
    if (!verify.ok) {
      return NextResponse.json({ ok: false, step: "verify", error: verify.error });
    }
    const result = await sendEmail({
      to: me.email,
      subject: `${APP_NAME}: SMTP test`,
      text: `Hello! If you can read this, your SMTP settings in ${APP_NAME} are configured correctly. Reminder emails will be delivered from now on.`,
      html: `<p>Hello! If you can read this, your SMTP settings in <strong>${APP_NAME}</strong> are configured correctly. Reminder emails will be delivered from now on.</p>`,
    });
    if (result.skipped) {
      return NextResponse.json({
        ok: false,
        step: "send",
        error: "SMTP not configured",
      });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (e) {
    return handleError(e);
  }
}
