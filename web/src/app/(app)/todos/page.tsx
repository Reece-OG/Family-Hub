import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { TodoList } from "@/components/TodoList";

export default async function TodosPage() {
  const me = await requireUser();
  if (!can(me, "canViewTodos")) {
    return <p className="muted">You don't have permission to view to-dos.</p>;
  }
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">To-Do List</h1>
      <TodoList
        canEdit={can(me, "canEditTodos")}
        isParent={me.role === "PARENT"}
      />
    </div>
  );
}
