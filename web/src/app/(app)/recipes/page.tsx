import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { RecipesView } from "@/components/RecipesView";

export default async function RecipesPage() {
  const me = await requireUser();
  if (!can(me, "canViewRecipes")) {
    return <p className="muted">You don't have permission to view recipes.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Recipes</h1>
      <RecipesView
        canEdit={can(me, "canEditRecipes")}
        canEditShopping={can(me, "canEditShopping")}
      />
    </div>
  );
}
