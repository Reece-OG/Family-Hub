import { getCurrentDevice, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MaintenanceView } from "@/components/MaintenanceView";

export default async function MaintenancePage() {
  const me = await requireUser();
  // v4.7.4 — Maintenance carries personal data (registration numbers,
  // insurance details, receipts) that shouldn't appear on a shared screen.
  // Kiosk sessions get a quiet placeholder rather than the live tab.
  const device = await getCurrentDevice();
  if (device) {
    return (
      <p className="muted">
        Maintenance is hidden on shared / kiosk devices. Sign in with your
        own account to view it.
      </p>
    );
  }
  if (!can(me, "canViewMaintenance")) {
    return (
      <p className="muted">You don't have permission to see maintenance.</p>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Maintenance</h1>
      <MaintenanceView
        me={{
          id: me.id,
          role: me.role,
          canManage: can(me, "canManageMaintenance"),
        }}
      />
    </div>
  );
}
