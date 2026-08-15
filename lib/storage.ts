import type { FlowchartDocument } from "./flowchart";
import { parseDocument } from "./parse";
import { getSupabase } from "./supabase";

/**
 * Loading and saving the one chart a user owns.
 *
 * The stored shape is the same flat JSON that *Copy JSON* produces — the main
 * chart with a `routines` object beside it — rather than the in-memory
 * `FlowchartDocument`. That means every load goes back through `parseDocument`
 * and gets the same validation and repair as a paste, so a row that was hand
 * edited, written by an older version, or truncated cannot put the board into
 * a state the rest of the app does not expect.
 */

export type StoredDoc = Record<string, unknown>;

export function toStored(doc: FlowchartDocument): StoredDoc {
  return Object.keys(doc.routines).length
    ? { ...doc.main, routines: doc.routines }
    : { ...doc.main };
}

export interface LoadResult {
  /** Null when the user has nothing saved yet — not an error. */
  doc: FlowchartDocument | null;
  error: string | null;
  /** Fixes the parser applied to the stored row, worth showing once. */
  repairs: string[];
  /** The chart's share token, or null when it is not being shared. */
  shareId?: string | null;
}

export async function loadChart(userId: string): Promise<LoadResult> {
  const supabase = getSupabase();
  if (!supabase) return { doc: null, error: "Supabase is not configured.", repairs: [] };

  const { data, error } = await supabase
    .from("flowcharts")
    .select("doc, share_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { doc: null, error: error.message, repairs: [] };
  const shareId = (data?.share_id as string | null) ?? null;
  if (!data?.doc) return { doc: null, error: null, repairs: [], shareId };

  const parsed = parseDocument(JSON.stringify(data.doc));
  if (!parsed.doc) {
    return { doc: null, error: `Saved chart could not be read — ${parsed.error}`, repairs: [], shareId };
  }
  return { doc: parsed.doc, error: null, repairs: parsed.repairs, shareId };
}

/**
 * Upsert the user's single row. Returns an error message, or null.
 *
 * `share_id` is deliberately not in the payload: an upsert writes every column
 * it names, so listing it here would clear the token on every autosave and
 * silently break a link the user had already handed out.
 */
export async function saveChart(
  userId: string,
  doc: FlowchartDocument,
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Supabase is not configured.";

  const { error } = await supabase
    .from("flowcharts")
    .upsert({ user_id: userId, doc: toStored(doc), updated_at: new Date().toISOString() });

  return error?.message ?? null;
}

// ---- share links --------------------------------------------------------

export interface ShareResult {
  shareId: string | null;
  error: string | null;
}

/**
 * Publish the user's chart, returning the token to build a link from.
 *
 * The token is generated here rather than by a column default so the round
 * trip returns it directly, and so re-sharing an already-shared chart hands
 * back the same link instead of quietly invalidating the old one.
 */
export async function startSharing(userId: string, existing: string | null): Promise<ShareResult> {
  if (existing) return { shareId: existing, error: null };

  const supabase = getSupabase();
  if (!supabase) return { shareId: null, error: "Supabase is not configured." };

  const token = crypto.randomUUID();
  // The row may not exist yet if nothing has been autosaved, so this has to be
  // an update rather than an insert — the caller saves first.
  const { data, error } = await supabase
    .from("flowcharts")
    .update({ share_id: token })
    .eq("user_id", userId)
    .select("share_id")
    .maybeSingle();

  if (error) return { shareId: null, error: error.message };
  if (!data) return { shareId: null, error: "Save the chart before sharing it." };
  return { shareId: (data.share_id as string) ?? token, error: null };
}

/** Revoke the link. Anyone still holding it gets nothing from then on. */
export async function stopSharing(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Supabase is not configured.";

  const { error } = await supabase
    .from("flowcharts")
    .update({ share_id: null })
    .eq("user_id", userId);

  return error?.message ?? null;
}

/**
 * Fetch a chart by share token.
 *
 * Goes through the `shared_chart` function rather than a table select: the
 * table is owner-only, and the function is written so a token buys exactly one
 * row and no way to enumerate the rest. See `supabase/schema.sql`.
 */
export async function loadSharedChart(token: string): Promise<LoadResult> {
  const supabase = getSupabase();
  if (!supabase) return { doc: null, error: "Supabase is not configured.", repairs: [] };

  const { data, error } = await supabase.rpc("shared_chart", { token });

  if (error) return { doc: null, error: error.message, repairs: [] };
  if (!data) {
    return {
      doc: null,
      error: "That share link is not valid — it may have been revoked.",
      repairs: [],
    };
  }

  // Same validation as a paste: a shared row is no more trustworthy than
  // pasted text, and this one was written by somebody else.
  const parsed = parseDocument(JSON.stringify(data));
  if (!parsed.doc) {
    return { doc: null, error: `Shared chart could not be read — ${parsed.error}`, repairs: [] };
  }
  return { doc: parsed.doc, error: null, repairs: parsed.repairs };
}
