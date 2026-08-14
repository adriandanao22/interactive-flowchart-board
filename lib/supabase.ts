import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase is optional. Without configuration the board still runs as a local
 * scratchpad — it just cannot sign anyone in or save. Keeping that path working
 * means the app needs no setup to be useful, which is how it behaved before
 * accounts existed.
 */

// Both names are read because Supabase renamed these keys: `sb_publishable_…`
// replaces the older `anon` JWT. They occupy the same slot and both respect
// Row Level Security, so either works. Next.js inlines NEXT_PUBLIC_* at build
// time by literal substitution, so each has to be written out in full rather
// than looked up dynamically.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const key = publishableKey || anonKey;

/**
 * Refuse a key that grants full database access.
 *
 * The secret key sits next to the publishable one in the Supabase dashboard,
 * and anything in a NEXT_PUBLIC_ variable is compiled into the JavaScript every
 * visitor downloads. A secret key there bypasses Row Level Security for anyone
 * who opens devtools, so this fails loudly rather than quietly working.
 */
function secretKeyProblem(candidate: string | undefined): string | null {
  if (!candidate) return null;

  if (candidate.startsWith("sb_secret_")) {
    return "That is the Supabase secret key. Use the publishable key — a secret key in a NEXT_PUBLIC_ variable is served to every visitor and bypasses Row Level Security.";
  }

  // Legacy keys are JWTs; the middle segment names the role.
  const segments = candidate.split(".");
  if (segments.length === 3) {
    try {
      const payload = JSON.parse(atob(segments[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.role === "service_role") {
        return "That is the Supabase service_role key. Use the anon or publishable key — a service_role key in a NEXT_PUBLIC_ variable is served to every visitor and bypasses Row Level Security.";
      }
    } catch {
      // Not a JWT we can read; let Supabase reject it if it is wrong.
    }
  }

  return null;
}

export const configProblem: string | null = secretKeyProblem(key);

export const supabaseConfigured = Boolean(url && key && !configProblem);

let client: SupabaseClient | null = null;

/** The browser client, or null when the project is not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  // One instance per tab: each `createClient` starts its own token refresh
  // timer and auth listener, so making more than one is a slow leak.
  client ??= createClient(url!, key!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Display name chosen at sign-up. Falls back to the email's local part. */
export function displayName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const username = user.user_metadata?.username;
  if (typeof username === "string" && username.trim()) return username.trim();
  return user.email?.split("@")[0] ?? "signed in";
}
