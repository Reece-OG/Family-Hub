import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { BirthdaysView } from "@/components/BirthdaysView";

export default async function BirthdaysPage() {
  const me = await requireUser();
  if (!can(me, "canViewCalendar")) {
    return <p className="muted">You don&apos;t have permission to view birthdays.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Birthdays</h1>
      <BirthdaysView
        canManage={me.role === "PARENT"}
        canEdit={can(me, "canEditCalendar")}
      />
    </div>
  );
}
