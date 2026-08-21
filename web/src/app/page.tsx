// The middleware already redirects / → /dashboard (when authed) or /login.
// This file is just a fallback.
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
