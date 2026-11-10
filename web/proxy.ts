import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: it checks that a session cookie exists, not that it is valid (the pages
// verify the real session). /auth is deliberately not redirected from here -- a stale cookie
// would bounce between / and /auth forever.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) return NextResponse.redirect(new URL("/auth", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/", "/profile"] };
