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
}

export async function loadChart(userId: string): Promise<LoadResult> {
  const supabase = getSupabase();
  if (!supabase) return { doc: null, error: "Supabase is not configured.", repairs: [] };

  const { data, error } = await supabase
    .from("flowcharts")
    .select("doc")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { doc: null, error: error.message, repairs: [] };
  if (!data?.doc) return { doc: null, error: null, repairs: [] };

  const parsed = parseDocument(JSON.stringify(data.doc));
  if (!parsed.doc) {
    return { doc: null, error: `Saved chart could not be read — ${parsed.error}`, repairs: [] };
  }
  return { doc: parsed.doc, error: null, repairs: parsed.repairs };
}

/** Upsert the user's single row. Returns an error message, or null. */
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
