"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ROLES, type Role } from "@/lib/roles";

const field =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none transition-colors focus:border-gold";

export default function ProfileForm() {
  const { data } = authClient.useSession();
  const user = data?.user;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setStatus(null);
    const { error } = await authClient.updateUser({
      name: String(form.get("name")).trim(),
      role: String(form.get("role")) as Role,
    });
    setBusy(false);
    setStatus(error ? { ok: false, text: error.message ?? "Couldn't save. Please try again." } : { ok: true, text: "Saved." });
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">Profile settings</h1>
        <p className="mt-1 text-sm text-muted">
          The assistant answers according to who you are, for example which price or payment method applies to you.
        </p>

        {/* key: remount with fresh defaults if the session reloads with different values */}
        <form key={`${user.name}|${user.role}`} onSubmit={save} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Name
            <input name="name" required maxLength={80} defaultValue={user.name} className={`${field} text-ink`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Email
            <input value={user.email} readOnly disabled className={`${field} text-muted opacity-70`} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            I am a…
            <select name="role" defaultValue={user.role ?? "outsider"} className={`${field} text-ink`}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {status && (
            <p role="status" className={`text-sm ${status.ok ? "text-gold" : "text-red-400"}`}>
              {status.text}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-gold rounded-xl py-3 text-sm disabled:opacity-60">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </main>
  );
}
