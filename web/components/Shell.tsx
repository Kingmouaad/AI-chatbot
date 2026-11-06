"use client";

import { ChefHat, PanelLeft, SquarePen } from "lucide-react";
import { useState } from "react";
import { selectChat, useChats } from "@/lib/chats";

// Clicking the logo shows/hides the sidebar. On hover the logo turns into the panel icon so it
// reads as a toggle (same trick as ChatGPT).
function LogoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Toggle sidebar"
      className="group grid size-10 shrink-0 place-items-center rounded-xl text-amber-400 hover:bg-hover"
    >
      <ChefHat className="size-6 group-hover:hidden" />
      <PanelLeft className="hidden size-5 text-muted group-hover:block" />
    </button>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  // Two flags instead of one: on desktop the sidebar pushes the chat aside (open by default), on
  // phones it is an overlay (closed by default). Using CSS breakpoints for each avoids reading
  // the viewport during render, so the server and client HTML match.
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { chats, activeId } = useChats();

  const toggle = () =>
    window.matchMedia("(min-width: 768px)").matches
      ? setDesktopOpen((open) => !open)
      : setMobileOpen((open) => !open);

  const pick = (id: string | null) => {
    selectChat(id);
    setMobileOpen(false);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 shrink-0 overflow-hidden bg-sidebar transition-[transform,width,visibility] duration-300 md:static md:translate-x-0 ${
          mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full"
        } ${desktopOpen ? "md:visible md:w-64" : "md:invisible md:w-0"}`}
      >
        {/* fixed inner width so the text doesn't reflow while the sidebar animates */}
        <nav className="flex h-full w-64 flex-col p-2">
          <div className="flex items-center gap-1">
            <LogoButton onClick={toggle} />
            <span className="font-semibold">Cafeteria AI</span>
          </div>

          <button
            onClick={() => pick(null)}
            className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-hover"
          >
            <SquarePen className="size-4" />
            New chat
          </button>

          <p className="px-3 pt-5 pb-1 text-xs font-medium text-muted">Recent</p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {chats.length === 0 && <li className="px-3 py-2 text-sm text-muted">No chats yet</li>}
            {chats.map((chat) => (
              <li key={chat.id}>
                <button
                  onClick={() => pick(chat.id)}
                  title={chat.title}
                  className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-hover ${
                    chat.id === activeId ? "bg-hover" : ""
                  }`}
                >
                  {chat.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-main">
        {/* the logo stays reachable while the sidebar is hidden */}
        <div className={`p-2 ${mobileOpen ? "hidden" : "flex"} ${desktopOpen ? "md:hidden" : "md:flex"}`}>
          <LogoButton onClick={toggle} />
        </div>
        {children}
      </div>
    </div>
  );
}
