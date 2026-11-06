"use client";

import { ArrowUp, ChefHat } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import BotMessage, { Avatar } from "@/components/BotMessage";
import { type Rating, sendChat, sendRating } from "@/lib/api";
import { addMessage, type BotMsg, setRating, uid, useChats } from "@/lib/chats";

const STARTERS = ["What's today's menu?", "What are your hours?", "Is the food halal?"];
const ERROR_TEXT = "Sorry, I couldn't reach the server. Please try again.";
const MAX_LENGTH = 1000; // matches the backend's chat_messages.user_message column
// Minimum time the "thinking" dots stay up, even when the API answers faster, so a reply feels
// generated rather than instant. A slower API just takes as long as it takes.
const THINK_MS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function ChatView() {
  const { chats, activeId, pending, fresh } = useChats();
  const messages = chats.find((c) => c.id === activeId)?.messages ?? [];
  const [input, setInput] = useState("");
  const busy = pending !== null || fresh !== null; // waiting for a reply, or still typing one out
  const thinking = pending !== null && pending === activeId;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Grow the textarea with its content (up to ~8 lines); shrinks back after sending.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking]);

  // Called on every animation frame while a reply types out. Only follows the text if the reader
  // is already at the bottom, so scrolling up to re-read something isn't fought.
  const keepInView = useCallback(() => {
    const el = scrollerRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    const chatId = addMessage(activeId, { id: uid(), role: "user", text: message });
    const [reply] = await Promise.all([sendChat(message).catch(() => null), sleep(THINK_MS)]);
    addMessage(
      chatId,
      reply
        ? { id: uid(), role: "bot", text: reply.reply, apiId: reply.message_id, suggestions: reply.suggestions }
        : { id: uid(), role: "bot", text: ERROR_TEXT, error: true },
      reply !== null,
    );
  }

  // Optimistic: the icon updates at once; if the API call fails it goes back to what it was.
  async function rate(m: BotMsg, next: Rating) {
    if (activeId === null || m.apiId === undefined) return;
    const previous = m.rating ?? null;
    setRating(activeId, m.id, next);
    try {
      await sendRating(m.apiId, next);
    } catch {
      setRating(activeId, m.id, previous);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 ? (
            <div className="m-auto flex flex-col items-center gap-6 text-center">
              <div className="grid size-12 place-items-center rounded-full bg-amber-400/15 text-amber-400">
                <ChefHat className="size-6" />
              </div>
              <h1 className="text-2xl font-semibold">How can I help you today?</h1>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={busy}
                    className="rounded-full border border-line px-4 py-2 text-sm text-muted hover:bg-hover hover:text-ink disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-3xl bg-surface px-5 py-2.5">
                    {m.text}
                  </p>
                </div>
              ) : (
                <BotMessage
                  key={m.id}
                  msg={m}
                  animate={m.id === fresh}
                  showSuggestions={i === messages.length - 1 && !busy}
                  onTick={keepInView}
                  onRate={(value) => rate(m, m.rating === value ? null : value)}
                  onSuggestion={send}
                />
              ),
            )
          )}

          {thinking && (
            <div className="flex gap-3" role="status">
              <Avatar />
              <div className="flex items-center gap-1.5 pt-1" aria-hidden="true">
                {[0, 1, 2].map((n) => (
                  <span
                    key={n}
                    className="size-2 animate-pulse rounded-full bg-muted [animation-duration:1s]"
                    style={{ animationDelay: `${n * 0.2}s` }}
                  />
                ))}
              </div>
              <span className="sr-only">Thinking…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        className="mx-auto w-full max-w-3xl px-4 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2 rounded-3xl bg-surface py-2 pr-2 pl-5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline; ignore Enter that confirms an IME composition
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            maxLength={MAX_LENGTH}
            placeholder="Ask about the menu, hours, or anything else…"
            aria-label="Message"
            className="max-h-[200px] flex-1 resize-none bg-transparent py-2 outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send message"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-main transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
        <p className="pt-2 text-center text-xs text-muted">Cafeteria AI answers in English and can make mistakes.</p>
      </form>
    </main>
  );
}
