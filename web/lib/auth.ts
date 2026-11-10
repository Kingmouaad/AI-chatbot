import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

// One pool per server process: `next dev` reloads this module, which would otherwise open a new
// pool (and hold Neon connections) on every edit.
const g = globalThis as unknown as { authPool?: Pool };
const pool = (g.authPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }));

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true },
  // Added only when configured, so the app still boots without Google credentials.
  socialProviders: process.env.GOOGLE_CLIENT_ID
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }
    : {},
  user: {
    additionalFields: {
      // student | teacher | worker | outsider. The default is what Google sign-ups get.
      role: { type: "string", required: false, defaultValue: "outsider", input: true },
    },
  },
  plugins: [nextCookies()],
});
