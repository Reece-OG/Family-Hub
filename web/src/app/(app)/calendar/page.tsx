import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CalendarView } from "@/components/CalendarView";
import { getSettings } from "@/lib/settings";

export default async function CalendarPage() {
  const me = await requireUser();
  if (!can(me, "canViewCalendar")) {
    return <p className="muted">You don't have permission to view the calendar.</p>;
  }
  const settings = await getSettings();
  const weekStartsOn = (settings.weekStartsOn === 0 ? 0 : 1) as 0 | 1;
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Calendar</h1>
      <CalendarView
        me={{ id: me.id, role: me.role, canEdit: can(me, "canEditCalendar") }}
        weekStartsOn={weekStartsOn}
      />
    </div>
  );
}
