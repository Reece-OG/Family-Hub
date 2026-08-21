import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { RewardsView } from "@/components/RewardsView";

export default async function RewardsPage() {
  const me = await requireUser();
  if (!can(me, "canViewRewards")) {
    return <p className="muted">You don't have permission to view rewards.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Rewards</h1>
      <RewardsView
        me={{
          id: me.id,
          role: me.role,
          canManage: can(me, "canManageRewards"),
        }}
      />
    </div>
  );
}
