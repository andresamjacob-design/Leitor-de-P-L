import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseConfig, requireSupabaseConfig } from "@/lib/env";

/**
 * Server-side Supabase client, carrying the signed-in user's JWT.
 *
 * There is deliberately no service-role client in this codebase yet. Every query runs as
 * the user, so Row Level Security is the actual boundary between entities and the tests
 * in `tests/rls` mean something (DECISIONS D16).
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The middleware
          // refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/** The signed-in user, or null — including when Supabase is not configured yet. */
export async function getUser() {
  if (readSupabaseConfig() === null) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
