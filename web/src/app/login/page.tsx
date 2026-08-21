import { Suspense } from "react";
import { PaintSplash } from "@/components/PaintSplash";
import LoginForm, { LoginCardShell } from "./LoginForm";

// `useSearchParams()` inside LoginForm bails out of static prerendering.
// Forcing the route to be dynamic skips the static-export attempt entirely
// during `next build` — and because this page is now a server component,
// the <Suspense> boundary here genuinely wraps the client-side hook, which
// is exactly what Next.js 14's missing-suspense-with-csr-bailout error is
// asking for.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="relative min-h-screen w-full overflow-hidden">
      <PaintSplash />
      <div className="relative z-10 min-h-screen w-full flex items-center justify-center p-6">
        <Suspense fallback={<LoginCardShell />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
