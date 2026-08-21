import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { StarredView } from "@/components/StarredView";

export default async function StarredPage() {
  const me = await requireUser();
  if (!can(me, "canViewCalendar")) {
    return <p className="muted">You don&apos;t have permission to view starred events.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Starred Events</h1>
      <StarredView
        me={{ id: me.id, role: me.role, canEdit: can(me, "canEditCalendar") }}
      />
    </div>
  );
}
