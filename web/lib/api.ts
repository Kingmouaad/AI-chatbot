// Talks to the FastAPI backend (api/). Browser-side only -- there is no Next.js server code
// in the request path, so NEXT_PUBLIC_API_URL ends up in the client bundle (it is a URL, not a secret).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ChatReply = {
  reply: string;
  suggestions: string[];
  intent: string | null;
  source: string;
  message_id: number;
};

export type Rating = 1 | -1 | null;

// `role` is the signed-in user's self-declared role (student | teacher | worker | outsider); the API
// uses it to word the few answers that depend on who is asking.
export async function sendChat(message: string, role: string): Promise<ChatReply> {
  const res = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, role }),
  });
  if (!res.ok) throw new Error(`POST /chat failed: ${res.status}`);
  return res.json();
}

export async function sendRating(messageId: number, rating: Rating): Promise<void> {
  const res = await fetch(`${API_URL}/chat/${messageId}/rating`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error(`PUT /chat/${messageId}/rating failed: ${res.status}`);
}
