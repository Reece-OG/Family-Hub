import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { RemindersView } from "@/components/RemindersView";

export default async function RemindersPage() {
  const me = await requireUser();
  if (!can(me, "canViewReminders")) {
    return <p className="muted">You don't have permission to see reminders.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Reminders</h1>
      <RemindersView
        me={{ id: me.id, role: me.role, canEdit: can(me, "canEditReminders") }}
      />
    </div>
  );
}
