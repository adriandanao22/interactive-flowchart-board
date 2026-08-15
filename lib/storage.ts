import type { FlowchartDocument } from "./flowchart";
import { parseDocument } from "./parse";
import { getSupabase } from "./supabase";

/**
 * Loading and saving a user's charts.
 *
 * The stored shape is the same flat JSON that *Copy JSON* produces — the main
 * chart with a `routines` object beside it — rather than the in-memory
 * `FlowchartDocument`. That means every load goes back through `parseDocument`
 * and gets the same validation and repair as a paste, so a row that was hand
 * edited, written by an older version, or truncated cannot put the board into
 * a state the rest of the app does not expect.
 *
 * A user owns many charts, each its own row. The name lives in its own column
 * rather than being read out of the document, so listing charts does not mean
 * pulling every document down with it.
 */

export type StoredDoc = Record<string, unknown>;

export function toStored(doc: FlowchartDocument): StoredDoc {
  return Object.keys(doc.routines).length
    ? { ...doc.main, routines: doc.routines }
    : { ...doc.main };
}

/** Enough to render the file list without loading any chart bodies. */
export interface ChartSummary {
  id: string;
  name: string;
  shareId: string | null;
  updatedAt: string;
}

export interface LoadResult {
  /** Null when there is nothing to load — not necessarily an error. */
  doc: FlowchartDocument | null;
  error: string | null;
  /** Fixes the parser applied to the stored row, worth showing once. */
  repairs: string[];
  name?: string;
  shareId?: string | null;
}

const NO_CLIENT = "Supabase is not configured.";

/** Fall back to something meaningful rather than an empty row in the list. */
export function nameFor(doc: FlowchartDocument): string {
  return doc.main.title.trim() || "Untitled chart";
}

/**
 * Make a name unique within a set.
 *
 * Nothing in the database stops two charts sharing a name, and there is no
 * good reason to — but a list with three rows reading "Exam Grader" is no use
 * to anyone, so imports and duplicates get a numeric suffix.
 */
export function uniqueName(wanted: string, taken: readonly string[]): string {
  const existing = new Set(taken.map((n) => n.trim().toLowerCase()));
  const base = wanted.trim() || "Untitled chart";
  if (!existing.has(base.toLowerCase())) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base} ${n}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

// ---- listing and loading -------------------------------------------------

export async function listCharts(
  userId: string,
): Promise<{ charts: ChartSummary[]; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { charts: [], error: NO_CLIENT };

  const { data, error } = await supabase
    .from("flowcharts")
    .select("id, name, share_id, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) return { charts: [], error: error.message };

  return {
    charts: (data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.name as string) ?? "Untitled chart",
      shareId: (row.share_id as string | null) ?? null,
      updatedAt: (row.updated_at as string) ?? "",
    })),
    error: null,
  };
}

export async function loadChart(chartId: string): Promise<LoadResult> {
  const supabase = getSupabase();
  if (!supabase) return { doc: null, error: NO_CLIENT, repairs: [] };

  const { data, error } = await supabase
    .from("flowcharts")
    .select("name, doc, share_id")
    .eq("id", chartId)
    .maybeSingle();

  if (error) return { doc: null, error: error.message, repairs: [] };
  if (!data) return { doc: null, error: "That chart no longer exists.", repairs: [] };

  const shareId = (data.share_id as string | null) ?? null;
  const name = (data.name as string) ?? "Untitled chart";

  const parsed = parseDocument(JSON.stringify(data.doc));
  if (!parsed.doc) {
    return {
      doc: null,
      error: `Saved chart could not be read — ${parsed.error}`,
      repairs: [],
      name,
      shareId,
    };
  }
  return { doc: parsed.doc, error: null, repairs: parsed.repairs, name, shareId };
}

// ---- writing -------------------------------------------------------------

/**
 * Create a chart and return its id.
 *
 * Insert rather than upsert: every call is meant to produce a new row, so a
 * collision should be an error rather than quietly overwriting something.
 */
export async function createChart(
  userId: string,
  name: string,
  doc: FlowchartDocument,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { id: null, error: NO_CLIENT };

  const { data, error } = await supabase
    .from("flowcharts")
    .insert({ user_id: userId, name, doc: toStored(doc) })
    .select("id")
    .single();

  if (error) return { id: null, error: error.message };
  return { id: data.id as string, error: null };
}

/**
 * Write a chart's contents back. Returns an error message, or null.
 *
 * `share_id` and `name` are deliberately absent: an update writes every column
 * it names, so listing them here would reset them on every autosave — clearing
 * a share link the user had already handed out, and undoing a rename.
 */
export async function saveChart(chartId: string, doc: FlowchartDocument): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return NO_CLIENT;

  const { error } = await supabase
    .from("flowcharts")
    .update({ doc: toStored(doc), updated_at: new Date().toISOString() })
    .eq("id", chartId);

  return error?.message ?? null;
}

export async function renameChart(chartId: string, name: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return NO_CLIENT;

  const { error } = await supabase
    .from("flowcharts")
    .update({ name: name.trim() || "Untitled chart" })
    .eq("id", chartId);

  return error?.message ?? null;
}

/**
 * Delete a chart.
 *
 * Any share link pointing at it dies with the row — there is nothing left for
 * the token to resolve to, so `shared_chart` returns nothing and the viewer
 * gets the same message as a revoked link.
 */
export async function deleteChart(chartId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return NO_CLIENT;

  const { error } = await supabase.from("flowcharts").delete().eq("id", chartId);
  return error?.message ?? null;
}

// ---- share links ---------------------------------------------------------

export interface ShareResult {
  shareId: string | null;
  error: string | null;
}

/**
 * Publish a chart, returning the token to build a link from.
 *
 * The token is generated here rather than by a column default so the round
 * trip returns it directly, and so re-sharing an already-shared chart hands
 * back the same link instead of quietly invalidating the old one.
 */
export async function startSharing(chartId: string, existing: string | null): Promise<ShareResult> {
  if (existing) return { shareId: existing, error: null };

  const supabase = getSupabase();
  if (!supabase) return { shareId: null, error: NO_CLIENT };

  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from("flowcharts")
    .update({ share_id: token })
    .eq("id", chartId)
    .select("share_id")
    .maybeSingle();

  if (error) return { shareId: null, error: error.message };
  if (!data) return { shareId: null, error: "That chart could not be found." };
  return { shareId: (data.share_id as string) ?? token, error: null };
}

/** Revoke the link. Anyone still holding it gets nothing from then on. */
export async function stopSharing(chartId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return NO_CLIENT;

  const { error } = await supabase
    .from("flowcharts")
    .update({ share_id: null })
    .eq("id", chartId);

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
  if (!supabase) return { doc: null, error: NO_CLIENT, repairs: [] };

  const { data, error } = await supabase.rpc("shared_chart", { token });

  if (error) return { doc: null, error: error.message, repairs: [] };
  // The function returns a set, so an unknown token is an empty array rather
  // than a null row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.doc) {
    return {
      doc: null,
      error: "That share link is not valid — it may have been revoked.",
      repairs: [],
    };
  }

  // Same validation as a paste: a shared row is no more trustworthy than
  // pasted text, and this one was written by somebody else.
  const parsed = parseDocument(JSON.stringify(row.doc));
  if (!parsed.doc) {
    return { doc: null, error: `Shared chart could not be read — ${parsed.error}`, repairs: [] };
  }
  return {
    doc: parsed.doc,
    error: null,
    repairs: parsed.repairs,
    name: (row.name as string) ?? undefined,
  };
}
