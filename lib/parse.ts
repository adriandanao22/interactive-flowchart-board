import {
  NODE_KINDS,
  type FlowEdgeSpec,
  type FlowNodeSpec,
  type FlowchartDocument,
  type FlowchartSpec,
  type NodeKind,
} from "./flowchart";

/**
 * Turns pasted text into a FlowchartSpec.
 *
 * The text is expected to come from a chat model, so it arrives dirty: wrapped
 * in markdown fences despite instructions, prefixed with "Here's the JSON:",
 * missing empty-string labels, using "input" where we want "io". Everything
 * recoverable is repaired and reported; everything else fails with a message
 * naming the offending value so it can be fixed by hand.
 */

export interface ParseResult {
  doc: FlowchartDocument | null;
  /** Set when the input could not be turned into a usable chart. */
  error: string | null;
  /** Things that were silently corrected, surfaced so the user can check them. */
  repairs: string[];
}

/** Guards against pasting something enormous and locking up the tab. */
const MAX_INPUT_CHARS = 2_000_000;

/**
 * Models name these shapes inconsistently. Accepting the obvious synonyms
 * costs nothing and saves a round trip to fix a one-word mismatch.
 */
const KIND_ALIASES: Record<string, NodeKind> = {
  begin: "start",
  entry: "start",
  stop: "end",
  finish: "end",
  terminate: "end",
  action: "process",
  operation: "process",
  rectangle: "process",
  statement: "process",
  condition: "decision",
  conditional: "decision",
  diamond: "decision",
  if: "decision",
  branch: "decision",
  input: "io",
  output: "io",
  inputoutput: "io",
  data: "io",
  parallelogram: "io",
  read: "io",
  write: "io",
  print: "io",
  predefinedprocess: "subroutine",
  call: "subroutine",
  function: "subroutine",
  procedure: "subroutine",
  module: "subroutine",
  onpageconnector: "connector",
  offpageconnector: "connector",
  junction: "connector",
  circle: "connector",
  reference: "connector",
  hexagon: "preparation",
  prep: "preparation",
  preparation: "preparation",
  init: "preparation",
  initialise: "preparation",
  initialize: "preparation",
  initialisation: "preparation",
  initialization: "preparation",
  setup: "preparation",
};

const VALID_KINDS = new Set<string>(NODE_KINDS);

function normaliseKind(raw: string): NodeKind | null {
  const key = raw.toLowerCase().replace(/[\s_\-/]/g, "");
  if (VALID_KINDS.has(key)) return key as NodeKind;
  return KIND_ALIASES[key] ?? null;
}

/**
 * Pull a JSON object out of whatever the model actually sent — fenced blocks,
 * a leading sentence, a trailing "Let me know if...".
 */
function extractJson(input: string): string {
  let text = input.trim();

  const fenced = /^```(?:json|jsonc)?\s*\n([\s\S]*?)\n?```$/i.exec(text);
  if (fenced) text = fenced[1].trim();

  if (text.startsWith("{")) return text;

  // Fall back to the outermost braces, which covers surrounding prose.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) return text.slice(first, last + 1).trim();

  return text;
}

/**
 * What may legally follow a closing quote: a structural character, or a comma
 * leading into either the next key or (tolerating a trailing comma) a closing
 * bracket.
 *
 * Demanding the whole `, "key":` shape rather than just a comma is what lets a
 * label like `print "a", "b"` survive — the comma there is followed by a bare
 * quoted word with no colon, so it reads as content rather than punctuation.
 */
const CLOSING_QUOTE = /^\s*(?:[}\]:]|,\s*(?:[}\]]|"[A-Za-z_][\w-]*"\s*:))/;

/** Decide whether the quote at `index` ends the string or is stray content. */
function looksLikeClose(text: string, index: number): boolean {
  const rest = text.slice(index + 1);
  return rest.trim() === "" || CLOSING_QUOTE.test(rest);
}

/**
 * Best-effort repair of the three ways chat models break this JSON:
 * unescaped quotes inside labels, raw line breaks inside strings, and trailing
 * commas.
 *
 * Only ever called after `JSON.parse` has already failed, so it cannot damage
 * valid input. It is a heuristic and will not save every mangled response —
 * when it fails, the original parse error is what gets reported.
 */
function repairLooseJson(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (inString) {
      if (ch === '"') {
        if (looksLikeClose(text, i)) {
          inString = false;
          out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      // Raw control characters are illegal inside a JSON string.
      if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else out += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      // Drop a comma that has nothing after it but a closing bracket.
      const rest = text.slice(i + 1);
      if (/^\s*[}\]]/.test(rest)) continue;
      out += ch;
      continue;
    }
    out += ch;
  }

  return out;
}

function fail(error: string): ParseResult {
  return { doc: null, error, repairs: [] };
}

/** Thrown by readChart and turned into a ParseResult by the caller. */
class ChartError extends Error {}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseDocument(input: string): ParseResult {
  const repairs: string[] = [];

  if (!input.trim()) return fail("Nothing to import — paste the JSON first.");
  if (input.length > MAX_INPUT_CHARS) {
    return fail("That paste is far larger than any flowchart should be.");
  }
  if (input.trim() === "NOT_A_FLOWCHART") {
    return fail("The model reported that the image was not a flowchart.");
  }

  const json = extractJson(input);
  if (json !== input.trim()) repairs.push("Stripped surrounding text or code fences.");

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    // Retry once with the loose-JSON repairs before giving up.
    try {
      raw = JSON.parse(repairLooseJson(json));
      repairs.push(
        "Repaired malformed JSON — unescaped quotes, raw line breaks, or trailing commas. Check the shape labels.",
      );
    } catch {
      const detail = cause instanceof Error ? cause.message : "unknown error";
      return fail(
        `That is not valid JSON — ${detail}. The usual cause is an unescaped " inside a label; ask the model to escape it as \\".`,
      );
    }
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Expected a JSON object with title, nodes, and edges.");
  }

  const source = raw as Record<string, unknown>;

  let main: FlowchartSpec;
  const routines: Record<string, FlowchartSpec> = {};
  try {
    main = readChart(source, repairs, "");

    // ---- routines -------------------------------------------------------
    const rawRoutines = source.routines;
    if (rawRoutines !== undefined) {
      if (typeof rawRoutines !== "object" || rawRoutines === null || Array.isArray(rawRoutines)) {
        return fail('"routines" must be an object mapping a name to a chart.');
      }
      for (const [key, value] of Object.entries(rawRoutines as Record<string, unknown>)) {
        const name = key.trim();
        if (!name) return fail("A routine has an empty name.");
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
          return fail(`Routine "${name}" is not a chart object.`);
        }
        routines[name] = readChart(value as Record<string, unknown>, repairs, `routine "${name}": `);
      }
    }
  } catch (cause) {
    if (cause instanceof ChartError) return fail(cause.message);
    throw cause;
  }

  return { doc: { main, routines }, error: null, repairs };
}

/**
 * Validate one chart object. Repairs are appended to the shared list; anything
 * unrecoverable throws a ChartError carrying a message that names the culprit.
 */
function readChart(
  source: Record<string, unknown>,
  repairs: string[],
  where: string,
): FlowchartSpec {
  const bad = (message: string): never => {
    throw new ChartError(where + message);
  };

  // ---- title ----------------------------------------------------------

  let title = asString(source.title)?.trim() ?? "";
  if (!title) {
    title = "Imported flowchart";
    repairs.push('No title given — using "Imported flowchart".');
  }

  // ---- nodes ----------------------------------------------------------

  if (!Array.isArray(source.nodes)) return bad('Missing a "nodes" array.');
  if (source.nodes.length === 0) return bad("The chart has no shapes in it.");

  const nodes: FlowNodeSpec[] = [];
  const seenIds = new Set<string>();

  for (const [index, entry] of source.nodes.entries()) {
    const where = `nodes[${index}]`;
    if (typeof entry !== "object" || entry === null) return bad(`${where} is not an object.`);
    const node = entry as Record<string, unknown>;

    const id = asString(node.id)?.trim();
    if (!id) return bad(`${where} has no id.`);
    if (seenIds.has(id)) return bad(`Two nodes share the id "${id}". Ids must be unique.`);
    seenIds.add(id);

    const rawKind = asString(node.kind)?.trim();
    if (!rawKind) return bad(`Node "${id}" has no kind.`);
    const kind = normaliseKind(rawKind);
    if (!kind) {
      return bad(
        `Node "${id}" has an unrecognised kind "${rawKind}". Valid kinds: ${NODE_KINDS.join(", ")}.`,
      );
    }
    if (kind !== rawKind) repairs.push(`Read kind "${rawKind}" on "${id}" as "${kind}".`);

    let label = asString(node.label) ?? "";
    if (!label.trim()) {
      label = id;
      repairs.push(`Node "${id}" had no label — using its id.`);
    }

    // Carry executable code through untouched. `expr` may legitimately be an
    // empty string (meaning "explicitly not code"), so test for the key
    // rather than for truthiness.
    const built: FlowNodeSpec = { id, kind, label };
    if (typeof node.expr === "string") built.expr = node.expr;
    const calls = asString(node.calls)?.trim();
    if (calls) built.calls = calls;
    nodes.push(built);
  }

  // ---- edges ----------------------------------------------------------

  const rawEdges: unknown = source.edges;
  if (rawEdges !== undefined && !Array.isArray(rawEdges)) {
    return bad('"edges" must be an array.');
  }
  if (rawEdges === undefined) repairs.push("No edges array — importing the shapes unconnected.");

  const edgeList: unknown[] = Array.isArray(rawEdges) ? rawEdges : [];
  const edges: FlowEdgeSpec[] = [];
  const seenEdgeIds = new Set<string>();

  for (const [index, entry] of edgeList.entries()) {
    const where = `edges[${index}]`;
    if (typeof entry !== "object" || entry === null) return bad(`${where} is not an object.`);
    const edge = entry as Record<string, unknown>;

    const sourceId = asString(edge.source)?.trim();
    const targetId = asString(edge.target)?.trim();
    if (!sourceId || !targetId) return bad(`${where} is missing a source or target.`);

    // A dangling arrow is a transcription slip, not a reason to reject the
    // whole chart — drop it and say so. The linter will flag what it leaves.
    if (!seenIds.has(sourceId) || !seenIds.has(targetId)) {
      const missing = !seenIds.has(sourceId) ? sourceId : targetId;
      repairs.push(`Dropped an arrow ${sourceId} → ${targetId}: there is no node "${missing}".`);
      continue;
    }

    let id = asString(edge.id)?.trim() ?? "";
    if (!id || seenEdgeIds.has(id)) {
      const generated = `e-${sourceId}-${targetId}-${index}`;
      if (id) repairs.push(`Two arrows shared the id "${id}" — renamed one to "${generated}".`);
      id = generated;
    }
    seenEdgeIds.add(id);

    // Always a string: lintSpec and the runner both call .trim() on it.
    const label = asString(edge.label) ?? "";

    edges.push({ id, source: sourceId, target: targetId, label });
  }

  // ---- params ---------------------------------------------------------

  const rawParams: unknown = source.params;
  if (rawParams !== undefined && !Array.isArray(rawParams)) {
    return bad('"params" must be an array of names.');
  }
  const params: string[] = [];
  for (const entry of Array.isArray(rawParams) ? rawParams : []) {
    const name = asString(entry)?.trim();
    if (!name) return bad("A parameter name is empty.");
    params.push(name);
  }

  return params.length ? { title, nodes, edges, params } : { title, nodes, edges };
}

/**
 * Cheap test for "does this pasted text look like it's meant to be a chart?",
 * used to decide whether a plain-text paste should be treated as an import.
 */
export function looksLikeSpec(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_INPUT_CHARS) return false;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) return false;
  return /"nodes"\s*:/.test(trimmed);
}
