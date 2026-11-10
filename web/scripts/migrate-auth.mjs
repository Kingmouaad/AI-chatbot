// Creates/updates Better Auth's tables (user, session, account, verification) in Neon.
// Run from web/:  node --env-file=.env.local scripts/migrate-auth.mjs
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/auth.ts";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
console.log("to create:", toBeCreated.map((t) => t.table), "| to add:", toBeAdded.map((t) => t.table));
await runMigrations();
console.log("auth tables are up to date");
process.exit(0);
