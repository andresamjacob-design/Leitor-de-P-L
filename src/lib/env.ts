/**
 * Environment access. Missing configuration is a first-class state, not a crash: the app
 * still boots and tells you what is missing (SPEC §14 — never a fake, always a reason).
 */

export type SupabaseConfig = {
  url: string;
  anonKey: string;
};

export function readSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = readSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local (veja .env.example).",
    );
  }
  return config;
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
