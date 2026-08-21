"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Home, Loader2, Mail, MonitorSmartphone } from "lucide-react";
import { APP_NAME } from "@/lib/app-name";

// Exported so the page-level <Suspense fallback> can render the same chrome
// while the client chunk hydrates — keeps the login card from flashing.
export function LoginCardShell({ children }: { children?: React.ReactNode }) {
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
            <h1 className="text-2xl font-bold leading-tight">{APP_NAME}</h1>
            <p className="text-sm muted">Welcome back — sign in to continue</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

type Mode = "email" | "device";

// `useSearchParams()` forces this component to opt into client-side
// rendering. Next.js 14's static-generation pass refuses to prerender the
// route unless the hook lives inside a <Suspense> boundary — so this
// component must be rendered from page.tsx wrapped in <Suspense>, not
// from a `"use client"` page directly.
export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const reason = params.get("reason");

  const [mode, setMode] = useState<Mode>("email");

  // Email-mode state
  const [email, setEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  // Device-mode state
  const [deviceName, setDeviceName] = useState("");
  const [devicePassword, setDevicePassword] = useState("");

  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    reason === "offnet"
      ? "This device session is restricted to the home network."
      : null,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url =
        mode === "email" ? "/api/auth/login" : "/api/auth/device-login";
      const body =
        mode === "email"
          ? { email, password: emailPassword }
          : { name: deviceName, password: devicePassword };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Login failed");
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LoginCardShell>
      {/* Mode tabs — email is the default for the broad audience; the device
          tab is for kiosks signing in on the home network. */}
      <div
        className="flex p-1 rounded-xl bg-black/5 dark:bg-white/5 mb-5"
        role="tablist"
        aria-label="Sign in mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "email"}
          onClick={() => {
            setMode("email");
            setError(null);
          }}
          className={
            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors " +
            (mode === "email"
              ? "bg-[rgb(var(--surface))] shadow-sm"
              : "muted hover:bg-black/5 dark:hover:bg-white/10")
          }
        >
          <Mail size={16} /> Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "device"}
          onClick={() => {
            setMode("device");
            setError(null);
          }}
          className={
            "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors " +
            (mode === "device"
              ? "bg-[rgb(var(--surface))] shadow-sm"
              : "muted hover:bg-black/5 dark:hover:bg-white/10")
          }
        >
          <MonitorSmartphone size={16} /> On this device
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {mode === "email" ? (
          <>
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
            <PasswordField
              label="Password"
              value={emailPassword}
              onChange={setEmailPassword}
              show={show}
              setShow={setShow}
              autoComplete="current-password"
            />
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Device name
              </label>
              <input
                className="input"
                type="text"
                required
                autoComplete="username"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder="Living Room"
              />
              <p className="mt-1.5 text-xs muted">
                Local devices only sign in from the home network.
              </p>
            </div>
            <PasswordField
              label="Device password"
              value={devicePassword}
              onChange={setDevicePassword}
              show={show}
              setShow={setShow}
              autoComplete="current-password"
            />
          </>
        )}

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
          {submitting ? "Signing In…" : "Sign In"}
        </button>
      </form>

      <p className="mt-6 text-xs muted text-center">
        Your family, on your terms. Self-hosted and ad-free.
      </p>
    </LoginCardShell>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  setShow,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  setShow: (fn: (s: boolean) => boolean) => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="relative">
        <input
          className="input pr-10"
          type={show ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
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
  );
}
