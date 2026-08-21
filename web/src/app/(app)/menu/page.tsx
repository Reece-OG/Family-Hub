import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { MenuView } from "@/components/MenuView";
import { getSettings } from "@/lib/settings";

export default async function MenuPage() {
  const me = await requireUser();
  if (!can(me, "canViewMenu")) {
    return <p className="muted">You don't have permission to view the menu.</p>;
  }
  const settings = await getSettings();
  const weekStartsOn = (settings.weekStartsOn === 0 ? 0 : 1) as 0 | 1;
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Menu Planner</h1>
      <MenuView canEdit={can(me, "canEditMenu")} weekStartsOn={weekStartsOn} />
    </div>
  );
}
