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
  "preparation",
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
  preparation: {
    name: "Preparation",
    shape: "Hexagon",
    blurb:
      "Sets things up before the work starts — initialising a variable, fixing a limit, preparing a loop. It runs like a process; the distinct shape tells a reader this is setup rather than part of the calculation.",
    example: "int passMark = 75",
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
 * Shown on first load so the board is useful straight away.
 *
 * Small enough to read at a glance while exercising all eight shapes and every
 * piece of notation the runner models: a preparation hexagon setting two
 * values, a connector pair carrying the retry back to the prompt, chained
 * decisions producing three outcomes, and two subroutines — one returning a
 * boolean, one switching on a value.
 */
export const SAMPLE_SPEC: FlowchartSpec = {
  title: "Exam Grader",
  nodes: [
    { id: "n1", kind: "start", label: "START" },
    // Runs once, before the retry loop, so a re-prompt does not reset it.
    { id: "n14", kind: "preparation", label: "int passMark = 85;\nint somewhatPass = 75" },
    // Entry half of the retry jump: control arrives here from the far end.
    { id: "n2", kind: "connector", label: "A" },
    { id: "n3", kind: "io", label: 'Display "Enter your score (0-100): "' },
    { id: "n4", kind: "io", label: "Input score" },
    { id: "n5", kind: "subroutine", label: "ok = checkScore(score)", calls: "checkScore" },
    { id: "n6", kind: "decision", label: "ok?" },
    { id: "n7", kind: "io", label: 'Display "Not a score from 0 to 100. Try again."' },
    { id: "n8", kind: "connector", label: "A" },
    { id: "n9", kind: "decision", label: "is score >= somewhatPass?" },
    { id: "n15", kind: "decision", label: "is score >= passMark?" },
    { id: "n10", kind: "process", label: 'String result = "PASS"' },
    { id: "n16", kind: "process", label: 'String result = "PASSABLE"' },
    { id: "n11", kind: "process", label: 'String result = "FAIL"' },
    // A second routine, this one switching on a value rather than a yes/no.
    { id: "n17", kind: "subroutine", label: "letter = letterFor(score)", calls: "letterFor" },
    { id: "n12", kind: "io", label: 'Display result + " (" + letter + ")"' },
    { id: "n13", kind: "end", label: "END" },
    // Exit half of a second jump. Breaking the chain here is what keeps the
    // chart from running off the bottom of the screen: the grading half lays
    // out as its own column instead of extending the input half.
    { id: "n18", kind: "connector", label: "B" },
    { id: "n19", kind: "connector", label: "B" },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n14", label: "" },
    { id: "e14", source: "n14", target: "n3", label: "" },
    { id: "e2", source: "n2", target: "n3", label: "" },
    { id: "e3", source: "n3", target: "n4", label: "" },
    { id: "e4", source: "n4", target: "n5", label: "" },
    { id: "e5", source: "n5", target: "n6", label: "" },
    { id: "e6", source: "n6", target: "n7", label: "NO" },
    { id: "e7", source: "n7", target: "n8", label: "" },
    { id: "e8", source: "n6", target: "n18", label: "YES" },
    { id: "e19", source: "n19", target: "n9", label: "" },
    { id: "e9", source: "n9", target: "n15", label: "YES" },
    { id: "e10", source: "n9", target: "n11", label: "NO" },
    { id: "e15", source: "n15", target: "n10", label: "YES" },
    { id: "e16", source: "n15", target: "n16", label: "NO" },
    { id: "e11", source: "n10", target: "n17", label: "" },
    { id: "e17", source: "n16", target: "n17", label: "" },
    { id: "e12", source: "n11", target: "n17", label: "" },
    { id: "e18", source: "n17", target: "n12", label: "" },
    { id: "e13", source: "n12", target: "n13", label: "" },
  ],
};

/** Validation: returns a boolean, so its caller branches YES / NO. */
const CHECK_SCORE_ROUTINE: FlowchartSpec = {
  title: "checkScore(score)",
  params: ["score"],
  nodes: [
    { id: "c1", kind: "start", label: "START" },
    {
      id: "c2",
      kind: "decision",
      label: "is the score a whole number from 0 to 100?",
      // This question has no operator form a reader would recognise, so it is
      // one of the few shapes that needs `expr`. `and` short-circuits, so text
      // never reaches the comparisons.
      expr: "isnumber(score) and score == int(score) and score >= 0 and score <= 100",
    },
    { id: "c3", kind: "process", label: "bool valid = true" },
    { id: "c4", kind: "process", label: "bool valid = false" },
    { id: "c5", kind: "end", label: "Return valid", expr: "return valid" },
  ],
  edges: [
    { id: "ce1", source: "c1", target: "c2", label: "" },
    { id: "ce2", source: "c2", target: "c3", label: "YES" },
    { id: "ce3", source: "c2", target: "c4", label: "NO" },
    { id: "ce4", source: "c3", target: "c5", label: "" },
    { id: "ce5", source: "c4", target: "c5", label: "" },
  ],
};

/**
 * A switch, to show an arrow condition is not only ever YES or NO.
 *
 * The decision produces a number and each arrow names the case it covers. One
 * arrow can carry several, as `case 9: case 10:` would, and `otherwise` is the
 * default that stops an uncovered value halting the run.
 */
/**
 * The textbook switch-case shape: one diamond per case, the false arm falling
 * through to the next test, and a default at the bottom that every remaining
 * value lands on. All four arms converge on the same return.
 *
 * Written as a routine so the main chart stays readable — the caller just sees
 * `letter = letterFor(score)`.
 */
const LETTER_FOR_ROUTINE: FlowchartSpec = {
  title: "letterFor(score)",
  params: ["score"],
  nodes: [
    { id: "g1", kind: "start", label: "START" },
    // The switch subject: computed once, then tested case by case.
    { id: "g2", kind: "preparation", label: "int band = int(score / 10)" },
    { id: "g3", kind: "decision", label: "is band >= 9?" },
    { id: "g4", kind: "process", label: 'String letter = "A"' },
    { id: "g5", kind: "decision", label: "is band == 8?" },
    { id: "g6", kind: "process", label: 'String letter = "B"' },
    { id: "g7", kind: "decision", label: "is band == 7?" },
    { id: "g8", kind: "process", label: 'String letter = "C"' },
    // No condition of its own — this is the default arm.
    { id: "g9", kind: "process", label: 'String letter = "F"' },
    { id: "g10", kind: "end", label: "Return letter", expr: "return letter" },
  ],
  edges: [
    { id: "ge1", source: "g1", target: "g2", label: "" },
    { id: "ge2", source: "g2", target: "g3", label: "" },
    { id: "ge3", source: "g3", target: "g4", label: "True" },
    { id: "ge4", source: "g3", target: "g5", label: "False" },
    { id: "ge5", source: "g5", target: "g6", label: "True" },
    { id: "ge6", source: "g5", target: "g7", label: "False" },
    { id: "ge7", source: "g7", target: "g8", label: "True" },
    { id: "ge8", source: "g7", target: "g9", label: "False" },
    { id: "ge9", source: "g4", target: "g10", label: "" },
    { id: "ge10", source: "g6", target: "g10", label: "" },
    { id: "ge11", source: "g8", target: "g10", label: "" },
    { id: "ge12", source: "g9", target: "g10", label: "" },
  ],
};

export const SAMPLE_DOC: FlowchartDocument = {
  main: SAMPLE_SPEC,
  routines: { checkScore: CHECK_SCORE_ROUTINE, letterFor: LETTER_FOR_ROUTINE },
};

/**
 * What *+ New* starts you with: the two terminators every flowchart needs and
 * the arrow between them, so the first shape you add has somewhere to go.
 *
 * Built fresh each call rather than shared as a constant — the board mutates
 * whatever it is handed, and a shared object would carry edits between charts.
 */
export function newChartDoc(title = "Untitled chart"): FlowchartDocument {
  return documentOf({
    title,
    nodes: [
      { id: "n1", kind: "start", label: "START" },
      { id: "n2", kind: "end", label: "END" },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2", label: "" }],
  });
}
