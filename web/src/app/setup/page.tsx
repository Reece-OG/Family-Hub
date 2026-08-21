import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaintSplash } from "@/components/PaintSplash";
import SetupForm from "./SetupForm";

// One-time account setup for the bootstrap parent. Reachable only when
// the signed-in user still has the `mustChangeCredentials` flag — anyone
// else gets sent back to the dashboard to keep this page out of
// navigation. Rendered dynamically because it mirrors the login page's
// animated background and reads per-request session state.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangeCredentials) redirect("/dashboard");

  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      <PaintSplash />
      <div className="relative z-10 min-h-screen w-full flex items-center justify-center p-6">
        <SetupForm
          currentEmail={user.email}
          currentName={user.name}
        />
      </div>
    </main>
  );
}
