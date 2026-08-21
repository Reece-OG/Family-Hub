import { requireParent } from "@/lib/auth";
import { UserManagement } from "@/components/UserManagement";

export default async function FamilyPage() {
  const me = await requireParent();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Family</h1>
      <UserManagement myId={me.id} />
    </div>
  );
}
