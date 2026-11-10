"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { roleLabel } from "@/lib/roles";

// Top-right account button. Opens a small panel with Profile settings and Log out.
export default function UserMenu() {
  const router = useRouter();
  const { data } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const user = data?.user;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  async function logout() {
    await authClient.signOut();
    router.replace("/auth");
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-hover"
      >
        <span className="grid size-8 place-items-center rounded-full bg-gold font-semibold text-black">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-32 truncate text-sm sm:block">{user.name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-40 mt-2 w-64 animate-fade-in rounded-2xl border border-line bg-sidebar p-2 shadow-xl shadow-black/50"
        >
          <div className="px-3 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <span className="mt-2 inline-block rounded-full bg-gold/15 px-2.5 py-0.5 text-xs text-gold">
              {roleLabel(user.role)}
            </span>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-hover"
          >
            <Settings className="size-4" />
            Profile settings
          </Link>
          <button
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
