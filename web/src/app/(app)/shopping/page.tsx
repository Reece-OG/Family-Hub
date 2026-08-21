import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ShoppingList } from "@/components/ShoppingList";

export default async function ShoppingPage() {
  const me = await requireUser();
  if (!can(me, "canViewShopping")) {
    return <p className="muted">You don't have permission to view the shopping list.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Shopping List</h1>
      <ShoppingList canEdit={can(me, "canEditShopping")} />
    </div>
  );
}
