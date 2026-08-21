"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Home, Loader2 } from "lucide-react";
import { APP_NAME } from "@/lib/app-name";

// First-login setup: the bootstrap parent replaces the well-known default
// parent@example.com / changeme credentials with their own email, name, and
// password. POST /api/auth/setup saves the new values and clears the
// mustChangeCredentials flag, so subsequent logins land straight on the
// dashboard.
export default function SetupForm({
  currentEmail,
  currentName,
}: {
  currentEmail: string;
  currentName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(
    currentName === "Parent" ? "" : currentName,
  );
  const [email, setEmail] = useState(
    currentEmail === "parent@example.com" ? "" : currentEmail,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Setup failed");
      }
      // Session cookie is rotated by the API so the claims reflect the new
      // email / name. Soft-replace to /dashboard and refresh to pick up the
      // cleared mustChangeCredentials flag on the next server render.
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="glass card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, #ff006e, #8338ec 55%, #3a86ff)",
            }}
          >
            <Home className="text-white" size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">
              Welcome to {APP_NAME}
            </h1>
            <p className="text-sm muted">
              Set up your parent account to get started.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Your name
            </label>
            <input
              className="input"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              className="input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              New password
            </label>
            <div className="relative">
              <input
                className="input pr-10"
                type={show ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                aria-label={show ? "Hide password" : "Show password"}
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg muted hover:bg-black/5 dark:hover:bg-white/10"
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              Confirm password
            </label>
            <input
              className="input"
              type={show ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Retype your password"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
          >
            {submitting && <Loader2 size={18} className="animate-spin" />}
            {submitting ? "Saving…" : "Save and continue"}
          </button>
        </form>

        <p className="mt-6 text-xs muted text-center">
          You can add more family members from Family &gt; Add Member later.
        </p>
      </div>
    </div>
  );
}
