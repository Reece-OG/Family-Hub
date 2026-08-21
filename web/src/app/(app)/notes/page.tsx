import { requireUser } from "@/lib/auth";
import { NotesView } from "@/components/NotesView";

// v4.9.2 — every signed-in user can view notes; module hide list (Settings
// → App Modules + per-kiosk overrides) is enforced upstream in the (app)
// layout, so this page just renders.
export default async function NotesPage() {
  const me = await requireUser();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Notes</h1>
      <NotesView
        me={{ id: me.id, role: me.role }}
      />
    </div>
  );
}
