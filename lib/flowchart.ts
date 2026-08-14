/**
 * The intermediate representation every flowchart flows through.
 *
 * The vision model extracts a `FlowchartSpec` from a pasted image; the board
 * lays it out, renders it, and walks it. Nothing downstream knows or cares
 * where the spec came from, so a future text/Mermaid importer only has to
 * produce this shape.
 */

export const NODE_KINDS = [
  "start",
  "end",
  "process",
  "decision",
  "io",
  "subroutine",
  "connector",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface FlowNodeSpec {
  id: string;
  kind: NodeKind;
  label: string;
  /**
   * Executable code for this shape, when the label is prose. An assignment
   * for a process, a condition for a decision, `print x` / `read x` for I/O,
   * `return x` for a routine's end. Omitted means "fall back to the label if
   * that happens to be code, otherwise this shape is prose".
   */
  expr?: string;
  /**
   * For a subroutine, the key of the routine it delegates to. Absent when the
   * body is defined outside this document — the usual case for a transcribed
   * chart — in which case the node is simply stepped over.
   */
  calls?: string;
}

export interface FlowEdgeSpec {
  id: string;
  source: string;
  target: string;
  /** Branch condition, e.g. "Yes" / "No". Empty string when unlabelled. */
  label: string;
}

export interface FlowchartSpec {
  title: string;
  nodes: FlowNodeSpec[];
  edges: FlowEdgeSpec[];
  /** Parameter names bound from the call's arguments, for a routine. */
  params?: string[];
}

/**
 * A chart plus the routines its subroutine nodes can call.
 *
 * Routines are held flat rather than nested inside the caller so a routine can
 * call another routine without the JSON turning into a tree. `null` is used
 * throughout as the key of the main chart.
 */
export interface FlowchartDocument {
  main: FlowchartSpec;
  routines: Record<string, FlowchartSpec>;
}

/** Resolve a chart key — `null` means the main chart. */
export function chartOf(doc: FlowchartDocument, key: string | null): FlowchartSpec | null {
  return key === null ? doc.main : (doc.routines[key] ?? null);
}

/** Every chart in the document, main first, paired with its key. */
export function allCharts(doc: FlowchartDocument): { key: string | null; spec: FlowchartSpec }[] {
  return [
    { key: null, spec: doc.main },
    ...Object.entries(doc.routines).map(([key, spec]) => ({ key, spec })),
  ];
}

/** Wrap a bare chart as a document with no routines. */
export function documentOf(spec: FlowchartSpec): FlowchartDocument {
  return { main: spec, routines: {} };
}

/** Teaching copy for the inspector panel — one entry per shape. */
export const KIND_INFO: Record<
  NodeKind,
  { name: string; shape: string; blurb: string; example: string }
> = {
  start: {
    name: "Terminator (Start)",
    shape: "Stadium / rounded rectangle",
    blurb:
      "Marks where control enters the program. A flowchart has exactly one start; every trace begins here.",
    example: "main() is called",
  },
  end: {
    name: "Terminator (End)",
    shape: "Stadium / rounded rectangle",
    blurb:
      "Marks where control leaves. A chart may have several ends — one per way the routine can finish.",
    example: "return 0",
  },
  process: {
    name: "Process",
    shape: "Rectangle",
    blurb:
      "A single action that changes state and always continues to exactly one next step. No branching happens here.",
    example: "total = price * quantity",
  },
  decision: {
    name: "Decision",
    shape: "Diamond",
    blurb:
      "Evaluates a condition and picks one outgoing branch. Every outgoing arrow must be labelled with the case it covers, and the cases must be exhaustive.",
    example: "if (n > 0)",
  },
  io: {
    name: "Input / Output",
    shape: "Parallelogram",
    blurb:
      "Data crosses the program boundary — reading from a user or file, printing, writing a response.",
    example: "print(result)",
  },
  subroutine: {
    name: "Subroutine",
    shape: "Rectangle with side bars",
    blurb:
      "Delegates to a named routine defined by its own flowchart elsewhere. Control returns here when it finishes.",
    example: "validate(input)",
  },
  connector: {
    name: "Connector",
    shape: "Circle",
    blurb:
      "A jump label used to avoid drawing a long arrow across the page. Control continues at the matching connector.",
    example: "goto A",
  },
};

/**
 * Split a typed routine name into the identifier code calls it by, the label
 * shown on the tab, and any parameters written in the signature.
 *
 * People naturally name a routine the way they will call it — "validate(limit)"
 * — so the key has to be the bare identifier or `validate(limit)` in a shape
 * would never match it.
 */
export function routineFromName(input: string): {
  key: string;
  title: string;
  params: string[];
} {
  const title = input.trim();
  const signature = /^([A-Za-z_]\w*)\s*\(([^)]*)\)$/.exec(title);
  if (signature) {
    const params = signature[2]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    return { key: signature[1], title, params };
  }
  const cleaned = title.replace(/[^A-Za-z0-9_]/g, "");
  const key = /^[A-Za-z_]/.test(cleaned) ? cleaned : `r${cleaned}`;
  return { key: key || "routine", title: title || "routine", params: [] };
}

/** Kinds that legitimately have more than one outgoing edge. */
export function isBranching(kind: NodeKind): boolean {
  return kind === "decision";
}

/**
 * Connectors are paired by their label — "A" jumps to the other "A". Matching
 * is case- and space-insensitive so a chart mixing "A" and "a" still links up.
 */
export function connectorKey(label: string): string {
  return label.trim().toLowerCase();
}

/** Every connector in the chart, grouped by the label that pairs them. */
export function connectorGroups(spec: FlowchartSpec): Map<string, FlowNodeSpec[]> {
  const groups = new Map<string, FlowNodeSpec[]>();
  for (const node of spec.nodes) {
    if (node.kind !== "connector") continue;
    const key = connectorKey(node.label);
    const group = groups.get(key);
    if (group) group.push(node);
    else groups.set(key, [node]);
  }
  return groups;
}

export interface LintWarning {
  /** Which chart the warning came from; null is the main chart. */
  chartKey?: string | null;
  /**
   * Stable, unique identity — `rule:subject`. Labels cannot serve this purpose
   * because two shapes may legitimately share one (two connectors both marked
   * "A", say), which would collide as a React key and, worse, leave the reader
   * unable to tell which shape is being complained about.
   */
  id: string;
  message: string;
  /** The shape at fault, when the warning is about a specific one. */
  nodeId?: string;
}

/**
 * Structural problems worth surfacing to a learner. These are lint warnings,
 * not errors — a chart with warnings still renders and still runs.
 */
export function lintSpec(spec: FlowchartSpec): LintWarning[] {
  const warnings: LintWarning[] = [];
  const outgoing = new Map<string, FlowEdgeSpec[]>();
  const incoming = new Map<string, FlowEdgeSpec[]>();

  for (const node of spec.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of spec.edges) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  const add = (id: string, message: string, nodeId?: string) =>
    warnings.push({ id, message, nodeId });

  const starts = spec.nodes.filter((n) => n.kind === "start");
  if (starts.length === 0) add("no-start", "No start terminator — nothing to run.");
  if (starts.length > 1)
    add("many-starts", `${starts.length} start terminators found; a flowchart should have one.`);
  if (!spec.nodes.some((n) => n.kind === "end"))
    add("no-end", "No end terminator — the chart never formally finishes.");

  // A connector deliberately has a missing arrow on one side — that is the
  // whole notation. Only complain when it has nothing to pair with.
  const groups = connectorGroups(spec);
  for (const [, group] of groups) {
    const label = group[0].label;
    if (group.length === 1) {
      add(
        `connector-unmatched:${group[0].id}`,
        `Connector "${label}" has no matching connector to jump to.`,
        group[0].id,
      );
    } else if (group.length > 2) {
      add(
        `connector-crowded:${group[0].id}`,
        `${group.length} connectors are labelled "${label}" — a jump needs exactly one matching pair.`,
        group[0].id,
      );
    }
  }

  // A pair only excuses a missing arrow if the other half actually supplies
  // it: control has to be able to arrive at one end and leave from the other.
  // Two connectors floating with no arrows at all are still broken.
  const groupCanLeave = new Map<string, boolean>();
  const groupCanArrive = new Map<string, boolean>();
  for (const [key, group] of groups) {
    groupCanLeave.set(key, group.some((n) => (outgoing.get(n.id)?.length ?? 0) > 0));
    groupCanArrive.set(key, group.some((n) => (incoming.get(n.id)?.length ?? 0) > 0));
  }

  for (const node of spec.nodes) {
    const out = outgoing.get(node.id) ?? [];
    const inc = incoming.get(node.id) ?? [];
    const key = node.kind === "connector" ? connectorKey(node.label) : null;
    const jumpsOut = key !== null && (groupCanLeave.get(key) ?? false);
    const jumpsIn = key !== null && (groupCanArrive.get(key) ?? false);

    if (node.kind === "decision" && out.length < 2)
      add(
        `decision-branches:${node.id}`,
        `"${node.label}" is a decision but has ${out.length} outgoing branch(es).`,
        node.id,
      );
    if (node.kind === "decision" && out.some((e) => !e.label.trim()))
      add(
        `branch-unlabelled:${node.id}`,
        `A branch out of "${node.label}" has no condition label.`,
        node.id,
      );
    if (!isBranching(node.kind) && node.kind !== "end" && out.length > 1)
      add(
        `too-many-out:${node.id}`,
        `"${node.label}" is not a decision but has ${out.length} outgoing arrows.`,
        node.id,
      );
    if (node.kind !== "end" && out.length === 0 && !jumpsOut)
      add(
        `dead-end:${node.id}`,
        `"${node.label}" is a dead end — no outgoing arrow and not a terminator.`,
        node.id,
      );
    if (node.kind !== "start" && inc.length === 0 && !jumpsIn)
      add(`unreachable:${node.id}`, `"${node.label}" is unreachable — nothing points at it.`, node.id);
  }

  return warnings;
}

/**
 * Lint every chart in a document, tagging which chart each warning came from
 * and checking that subroutine nodes point at routines that actually exist.
 */
export function lintDocument(doc: FlowchartDocument): LintWarning[] {
  const warnings: LintWarning[] = [];

  for (const { key, spec } of allCharts(doc)) {
    const prefix = key === null ? "" : `${spec.title || key}: `;

    for (const warning of lintSpec(spec)) {
      warnings.push({
        ...warning,
        id: key === null ? warning.id : `${key}/${warning.id}`,
        message: prefix + warning.message,
        chartKey: key,
      });
    }

    for (const node of spec.nodes) {
      if (!node.calls || doc.routines[node.calls]) continue;
      warnings.push({
        id: `${key ?? "main"}/missing-routine:${node.id}`,
        message: `${prefix}"${node.label}" calls a routine "${node.calls}" that is not in this document.`,
        nodeId: node.id,
        chartKey: key,
      });
    }
  }

  return warnings;
}

/**
 * Shown on first load so the board is useful without an API key.
 *
 * Deliberately exercises all seven shapes: the validation call is a
 * subroutine, and the error path exits through a connector pair rather than
 * dragging a long arrow down the page — the textbook reason connectors exist.
 */
export const SAMPLE_SPEC: FlowchartSpec = {
  title: "FizzBuzz",
  nodes: [
    { id: "n1", kind: "start", label: "Start" },
    { id: "n2", kind: "io", label: "read limit" },
    { id: "n3", kind: "subroutine", label: "valid = validate(limit)", calls: "validate" },
    { id: "n4", kind: "decision", label: "valid?", expr: "valid" },
    { id: "n5", kind: "io", label: 'print "limit must be a whole number above 0"' },
    { id: "n6", kind: "connector", label: "A" },
    { id: "n7", kind: "process", label: "i = 1" },
    { id: "n8", kind: "decision", label: "i <= limit?", expr: "i <= limit" },
    { id: "n9", kind: "decision", label: "i divisible by 15?", expr: "i % 15 == 0" },
    { id: "n10", kind: "io", label: 'print "FizzBuzz"' },
    { id: "n11", kind: "decision", label: "i divisible by 3?", expr: "i % 3 == 0" },
    { id: "n12", kind: "io", label: 'print "Fizz"' },
    { id: "n13", kind: "decision", label: "i divisible by 5?", expr: "i % 5 == 0" },
    { id: "n14", kind: "io", label: 'print "Buzz"' },
    { id: "n15", kind: "io", label: "print i" },
    { id: "n16", kind: "process", label: "i = i + 1" },
    { id: "n17", kind: "connector", label: "A" },
    { id: "n18", kind: "end", label: "End" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "No" },
    { id: "e5", source: "n5", target: "n6", label: "" },
    { id: "e6", source: "n4", target: "n7", label: "Yes" },
    { id: "e7", source: "n7", target: "n8", label: "" },
    { id: "e8", source: "n8", target: "n9", label: "Yes" },
    { id: "e9", source: "n8", target: "n18", label: "No" },
    { id: "e10", source: "n9", target: "n10", label: "Yes" },
    { id: "e11", source: "n9", target: "n11", label: "No" },
    { id: "e12", source: "n11", target: "n12", label: "Yes" },
    { id: "e13", source: "n11", target: "n13", label: "No" },
    { id: "e14", source: "n13", target: "n14", label: "Yes" },
    { id: "e15", source: "n13", target: "n15", label: "No" },
    { id: "e16", source: "n10", target: "n16", label: "" },
    { id: "e17", source: "n12", target: "n16", label: "" },
    { id: "e18", source: "n14", target: "n16", label: "" },
    { id: "e19", source: "n15", target: "n16", label: "" },
    { id: "e20", source: "n16", target: "n8", label: "" },
    { id: "e21", source: "n17", target: "n18", label: "" },
  ],
};

/** The body of `validate(limit)`, run when the trace enters the subroutine. */
const VALIDATE_ROUTINE: FlowchartSpec = {
  title: "validate(limit)",
  params: ["limit"],
  nodes: [
    { id: "v1", kind: "start", label: "Start" },
    {
      id: "v2",
      kind: "decision",
      label: "is limit a whole number above 0?",
      // `and` short-circuits, so a non-numeric limit never reaches the
      // comparison — which is the whole point of validating it here.
      expr: "isnumber(limit) and limit > 0 and limit == int(limit)",
    },
    { id: "v3", kind: "process", label: "result = true" },
    { id: "v4", kind: "process", label: "result = false" },
    { id: "v5", kind: "end", label: "Return result", expr: "return result" },
  ],
  edges: [
    { id: "ve1", source: "v1", target: "v2", label: "" },
    { id: "ve2", source: "v2", target: "v3", label: "Yes" },
    { id: "ve3", source: "v2", target: "v4", label: "No" },
    { id: "ve4", source: "v3", target: "v5", label: "" },
    { id: "ve5", source: "v4", target: "v5", label: "" },
  ],
};

export const SAMPLE_DOC: FlowchartDocument = {
  main: SAMPLE_SPEC,
  routines: { validate: VALIDATE_ROUTINE },
};
