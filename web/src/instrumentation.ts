// Runs exactly once on Next.js server boot (thanks to experimental.instrumentationHook).
// We start the reminder scheduler here so reminders fire automatically — even
// if no user has a browser tab open.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startReminderScheduler } = await import("./lib/reminder-scheduler");
  startReminderScheduler();
}
