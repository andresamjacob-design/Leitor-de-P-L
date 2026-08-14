/**
 * Reads `.env.local` into `process.env`.
 *
 * `next dev` does this on its own, but `drizzle-kit` does not — and without it the only
 * way to run a migration would be to paste the database password on the command line,
 * where it lands in the shell history. A secret that is easy to leak eventually leaks.
 *
 * The seed script uses Node's own `--env-file-if-exists` instead; this exists for
 * `drizzle.config.ts`, which drizzle-kit loads itself and where that flag cannot reach.
 *
 * Deliberately does not overwrite a variable that is already set, so
 * `DATABASE_URL=... npm run db:migrate` still wins over the file.
 */

import { readFileSync } from "node:fs";

export function loadEnvLocal(file = ".env.local"): void {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return; // No file is a valid state — the caller reports what is missing.
  }

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    // A quoted value may legitimately contain `#`, so quotes are stripped after reading.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}
