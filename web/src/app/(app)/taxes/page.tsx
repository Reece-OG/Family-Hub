import { getCurrentDevice, requireUser } from "@/lib/auth";
import { TaxesView } from "@/components/TaxesView";

export default async function TaxesPage() {
  const me = await requireUser();

  // My Taxes is strictly per-user and intentionally never appears on shared
  // kiosk sessions. The Nav already hides the tab on devices, but block at
  // the page level too in case someone deep-links.
  const device = await getCurrentDevice();
  if (device) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">My Taxes</h1>
        <p className="muted">
          My Taxes is private and not available on shared / kiosk devices.
          Sign in with your own account to use it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Taxes</h1>
      <TaxesView
        me={{ id: me.id, name: me.name, role: me.role }}
      />
    </div>
  );
}
