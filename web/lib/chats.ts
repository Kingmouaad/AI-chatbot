"use client";

// Chat history lives in the browser only: the backend is anonymous and stateless per message
// (it logs every exchange but has no notion of a conversation), so the sidebar's "Recent" list is
// localStorage. A tiny external store + useSyncExternalStore keeps the server render and the first
// client render identical (empty), then swaps in the saved chats without a hydration mismatch.
//
// `pending` and `fresh` live in the same store as the messages on purpose: they must change in
// the same commit as the message they describe, otherwise a reply could render one frame before
// the UI knows it should type it out, and the animation would be skipped.
import { useSyncExternalStore } from "react";
import type { Rating } from "@/lib/api";

export type Msg =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "bot";
      text: string;
      apiId?: number; // message_id from POST /chat, needed to send feedback
      rating?: Rating;
      suggestions?: string[];
      error?: boolean;
    };
export type BotMsg = Extract<Msg, { role: "bot" }>;
export type Chat = { id: string; title: string; messages: Msg[] };
type State = {
  chats: Chat[];
  activeId: string | null;
  pending: string | null; // id of the chat whose latest user message is still waiting for a reply
  fresh: string | null; // id of the bot message currently being typed out (not persisted)
};

let KEY = "cafeteriaai.chats";
const SERVER_STATE: State = { chats: [], activeId: null, pending: null, fresh: null };

let state: State | null = null;
const listeners = new Set<() => void>();

/**
 * Chat history is stored per account. Called by AuthGate before any chat UI mounts (so there are
 * no subscribers to notify); a different account starts from its own saved chats.
 */
export function setChatOwner(userId: string) {
  const key = `cafeteriaai.chats.${userId}`;
  if (key === KEY) return;
  KEY = key;
  state = null;
}

function load(): Chat[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return []; // corrupt or unavailable storage: start empty rather than crash the UI
  }
}

const getState = () => (state ??= { ...SERVER_STATE, chats: load() });

function commit(next: State) {
  const chatsChanged = next.chats !== getState().chats;
  state = next;
  if (chatsChanged) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next.chats));
    } catch {} // storage full / blocked: keep working in memory
  }
  listeners.forEach((l) => l());
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function useChats(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getState,
    () => SERVER_STATE,
  );
}

/** Switching chats also cancels any typing animation: that reply simply shows up complete. */
export function selectChat(id: string | null) {
  commit({ ...getState(), activeId: id, fresh: null });
}

/**
 * Appends a message. With chatId null (or unknown) it starts a new chat titled after the message.
 * A user message marks the chat as waiting for a reply; a bot message clears that, and with
 * `typeOut` it is flagged to be animated (only if its chat is the one on screen).
 */
export function addMessage(chatId: string | null, msg: Msg, typeOut = false): string {
  const s = getState();
  const known = chatId !== null && s.chats.some((c) => c.id === chatId);
  const id = known ? chatId : uid();
  const chats = known
    ? s.chats.map((c) => (c.id === id ? { ...c, messages: [...c.messages, msg] } : c))
    : [{ id, title: msg.text.length > 40 ? `${msg.text.slice(0, 40)}…` : msg.text, messages: [msg] }, ...s.chats];
  const activeId = known ? s.activeId : id;
  commit({
    chats,
    activeId,
    pending: msg.role === "user" ? id : null,
    fresh: typeOut && id === activeId ? msg.id : s.fresh,
  });
  return id;
}

export function finishTyping() {
  commit({ ...getState(), fresh: null });
}

export function setRating(chatId: string, msgId: string, rating: Rating) {
  commit({
    ...getState(),
    chats: getState().chats.map((c) =>
      c.id !== chatId
        ? c
        : { ...c, messages: c.messages.map((m) => (m.id === msgId && m.role === "bot" ? { ...m, rating } : m)) },
    ),
  });
}
