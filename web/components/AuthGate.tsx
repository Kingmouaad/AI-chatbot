"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Logo from "@/components/Logo";
import { authClient } from "@/lib/auth-client";
import { setChatOwner } from "@/lib/chats";

// Renders the app only for a signed-in user. proxy.ts already bounces visitors with no session
// cookie; this is the real check (a stale cookie gets sent to /auth here).
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isPending } = authClient.useSession();
  const user = data?.user;

  useEffect(() => {
    if (!isPending && !user) router.replace("/auth");
  }, [isPending, user, router]);

  if (!user) {
    return (
      <div className="grid h-dvh place-items-center" role="status">
        <Logo size={96} className="animate-pulse" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  // Chat history is per account, so a shared browser doesn't mix two people's chats.
  setChatOwner(user.id);
  return <>{children}</>;
}
