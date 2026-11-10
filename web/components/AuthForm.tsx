"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import { authClient } from "@/lib/auth-client";
import { ROLES, type Role } from "@/lib/roles";

type Mode = "login" | "signup";

const field =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-gold";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.27c0-.8-.07-1.57-.2-2.3H12v4.35h6.17a5.28 5.28 0 0 1-2.29 3.46v2.87h3.7C21.74 18.65 23 15.7 23 12.27Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.7-2.87c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.74v2.97A11.5 11.5 0 0 0 12 23.5Z" />
      <path fill="#FBBC05" d="M5.55 14.2a6.9 6.9 0 0 1 0-4.4V6.83H1.74a11.5 11.5 0 0 0 0 10.34l3.81-2.97Z" />
      <path fill="#EA4335" d="M12 5.06c1.69 0 3.2.58 4.4 1.72l3.28-3.28A11.04 11.04 0 0 0 12 .5 11.5 11.5 0 0 0 1.74 6.83l3.81 2.97C6.46 7.08 9 5.06 12 5.06Z" />
    </svg>
  );
}

export default function AuthForm() {
  const router = useRouter();
  const { data } = authClient.useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. just came back from Google): go to the chat.
  useEffect(() => {
    if (data?.user) router.replace("/");
  }, [data, router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const { error } =
      mode === "login"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            name: String(form.get("name")).trim(),
            email,
            password,
            role: String(form.get("role")) as Role,
          });
    if (error) {
      setError(error.message ?? "Something went wrong. Please try again.");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  async function google() {
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    if (error) {
      // no GOOGLE_CLIENT_ID configured on the server, or the popup/redirect was refused
      setError("Google sign-in isn't available right now. Use email and password instead.");
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl"
      />

      <div className="glow-border relative w-full max-w-md">
        <div className="rounded-3xl bg-sidebar px-6 py-8 sm:px-8">
          <div className="flex flex-col items-center gap-1 text-center">
            <Logo size={104} />
            <h1 className="text-2xl font-semibold">Cafeteria AI</h1>
            <p className="text-sm text-muted">
              {mode === "login" ? "Welcome back. Log in to keep chatting." : "Create your account to get started."}
            </p>
          </div>

          <div role="tablist" className="mt-6 grid grid-cols-2 rounded-xl bg-surface p-1">
            {(
              [
                ["login", "Log in"],
                ["signup", "Sign up"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`rounded-lg py-2 text-sm font-medium ${
                  mode === value ? "bg-gold text-black" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-white py-3 text-sm font-medium text-black disabled:opacity-60"
          >
            <GoogleIcon />
            Continue with Google
          </button>
          {mode === "signup" && (
            <p className="pt-2 text-center text-xs text-muted">
              Google accounts start as <span className="text-gold">Outsider</span>. You can change this later in
              Profile settings.
            </p>
          )}

          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            or with email
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            {mode === "signup" && (
              <input name="name" required maxLength={80} autoComplete="name" placeholder="Full name" aria-label="Full name" className={field} />
            )}
            <input name="email" type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={field} />
            <input
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "login" ? "Password" : "Password (8+ characters)"}
              aria-label="Password"
              className={field}
            />
            {mode === "signup" && (
              <label className="flex flex-col gap-1.5 text-sm text-muted">
                I am a…
                <select name="role" defaultValue="student" className={`${field} text-ink`}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-gold mt-1 rounded-xl py-3 text-sm disabled:opacity-60">
              {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
