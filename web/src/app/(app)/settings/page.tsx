import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { SettingsView } from "@/components/SettingsView";

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role !== "PARENT") {
    redirect("/dashboard");
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <SettingsView />
    </div>
  );
}
