"use client";

// Chat history lives in the browser only: the backend is anonymous and stateless per message
// (it logs every exchange but has no notion of a conversation), so the sidebar's "Recent" list is
// localStorage. A tiny external store + useSyncExternalStore keeps the server render and the first
// client render identical (empty), then swaps in the saved chats without a hydration mismatch.
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
export type Chat = { id: string; title: string; messages: Msg[] };
type State = { chats: Chat[]; activeId: string | null };

const KEY = "cafeteriaai.chats";
const SERVER_STATE: State = { chats: [], activeId: null };

let state: State | null = null;
const listeners = new Set<() => void>();

function load(): Chat[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return []; // corrupt or unavailable storage: start empty rather than crash the UI
  }
}

const getState = () => (state ??= { chats: load(), activeId: null });

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

export function selectChat(id: string | null) {
  commit({ ...getState(), activeId: id });
}

/** Appends to a chat; with chatId null it starts a new one (titled after the first message). Returns the chat id. */
export function addMessage(chatId: string | null, msg: Msg): string {
  const { chats } = getState();
  if (chatId && chats.some((c) => c.id === chatId)) {
    commit({
      ...getState(),
      chats: chats.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, msg] } : c)),
    });
    return chatId;
  }
  const id = uid();
  const title = msg.text.length > 40 ? `${msg.text.slice(0, 40)}…` : msg.text;
  commit({ chats: [{ id, title, messages: [msg] }, ...chats], activeId: id });
  return id;
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
