"use client";

import gsap from "gsap";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { finishTyping, type BotMsg } from "@/lib/chats";

const CHAR_DELAY = 0.02; // seconds between one character appearing and the next
const MAX_TYPING = 4; // a long reply is sped up so it never takes longer than this

export function Avatar() {
  return (
    <div className="grid size-8 shrink-0 place-items-center">
      <Logo size={32} />
    </div>
  );
}

type Props = {
  msg: BotMsg;
  animate: boolean; // true only while a reply that just arrived is being typed out
  showSuggestions: boolean;
  onTick: () => void; // lets the chat keep itself scrolled while text appears
  onRate: (rating: 1 | -1) => void;
  onSuggestion: (text: string) => void;
};

export default function BotMessage({ msg, animate, showSuggestions, onTick, onRate, onSuggestion }: Props) {
  // Decided once, at mount: only a reply that has just arrived is typed out. Older messages (and
  // everything reloaded from localStorage) render as plain text. `onTick` must stay referentially
  // stable, or the effect below would restart the animation on every render.
  const [typing] = useState(animate);
  const charsRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = charsRef.current;
    if (!typing || !el) return;
    const chars = Array.from(el.children);
    if (chars.length === 0) return finishTyping();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // First character, then the second, and so on: each fades in a beat after the previous one.
    const ctx = gsap.context(() => {
      gsap.to(chars, {
        opacity: 1,
        duration: reduced ? 0 : 0.05,
        ease: "none",
        stagger: reduced ? 0 : Math.min(CHAR_DELAY, MAX_TYPING / chars.length),
        onUpdate: onTick,
        onComplete: finishTyping,
      });
    }, charsRef);
    return () => ctx.revert();
  }, [typing, onTick]);

  const done = !animate; // feedback icons and suggestions only appear once the text is complete

  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1">
        <p className={`whitespace-pre-wrap break-words pt-1 ${msg.error ? "text-red-400" : ""}`}>
          {typing ? (
            <>
              {/* screen readers get the whole reply at once instead of one letter at a time */}
              <span className="sr-only">{msg.text}</span>
              <span ref={charsRef} aria-hidden="true">
                {Array.from(msg.text).map((ch, i) => (
                  <span key={i} className="opacity-0">
                    {ch}
                  </span>
                ))}
              </span>
            </>
          ) : (
            msg.text
          )}
        </p>

        {done && !msg.error && (
          <div className="mt-2 flex animate-fade-in gap-1">
            {(
              [
                [1, ThumbsUp, "Good response"],
                [-1, ThumbsDown, "Bad response"],
              ] as const
            ).map(([value, Icon, label]) => {
              const selected = msg.rating === value;
              return (
                <button
                  key={value}
                  onClick={() => onRate(value)}
                  aria-label={label}
                  aria-pressed={selected}
                  className={`rounded-lg p-1.5 hover:bg-hover ${selected ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  <Icon className={`size-4 ${selected ? "fill-current" : ""}`} />
                </button>
              );
            })}
          </div>
        )}

        {done && showSuggestions && msg.suggestions && (
          <div className="mt-3 flex animate-fade-in flex-wrap gap-2">
            {msg.suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
