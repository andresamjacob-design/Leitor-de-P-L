import { defineConfig } from "drizzle-kit";
import { loadEnvLocal } from "./scripts/load-env.ts";

// drizzle-kit does not read .env.local on its own, and the alternative is pasting the
// database password into the shell.
loadEnvLocal();

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl(),
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL não definido. Copie .env.example para .env.local e preencha a " +
        "connection string do Supabase (Project Settings › Database › Connection string › URI).",
    );
  }
  return url;
}
