import { requireUser, getCurrentDevice } from "@/lib/auth";
import { redirect } from "next/navigation";
import { VoiceSettingsView } from "@/components/VoiceSettingsView";

// v4.9.5 — voice readout settings live on the LocalDevice row, so this
// page only makes sense when the visitor is signed in AS a kiosk (device
// session). Email sessions get bounced back to /settings where the parent
// can edit the on/off toggle remotely.
export default async function VoiceSettingsPage() {
  await requireUser();
  const device = await getCurrentDevice();
  if (!device) {
    redirect("/settings");
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Voice Readout</h1>
      <p className="muted text-sm mb-4">
        When enabled, reminders are read out loud on this kiosk. Available
        voices depend on the kiosk&apos;s browser and operating system, so
        the picker below shows what&apos;s installed on <strong>this</strong>{" "}
        screen specifically.
      </p>
      <VoiceSettingsView deviceId={device.id} deviceName={device.name} />
    </div>
  );
}
