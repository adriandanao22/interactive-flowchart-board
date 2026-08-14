import {
  ExprError,
  callBuiltin,
  coerceInput,
  evaluate,
  isBareReference,
  parseExpression,
  parseStatement,
  stringify,
  type Scope,
  type Statement,
  type Value,
} from "./expr";
import {
  chartOf,
  connectorKey,
  type FlowEdgeSpec,
  type FlowNodeSpec,
  type FlowchartDocument,
  type FlowchartSpec,
} from "./flowchart";

/**
 * Walks a flowchart the way a reader would: one node at a time, stopping at
 * decisions to ask which branch to take. Deliberately not an interpreter —
 * node labels are prose, not expressions, so the human supplies the branch.
 *
 * Two pieces of notation are modelled rather than stepped over, because both
 * are about control going somewhere the arrows do not show:
 *  - a connector jumps to the matching connector elsewhere in the chart;
 *  - a subroutine call pushes a frame, runs another chart, and returns to the
 *    call site when that chart reaches its end.
 */

export type RunStatus =
  /** Not started. */
  | "idle"
  /** Sitting on a node with a single unambiguous next step. */
  | "running"
  /** Sitting on a decision, waiting for the user to choose a branch. */
  | "awaiting"
  /** Sitting on an input shape, waiting for a value to be typed in. */
  | "input"
  /** Reached a terminator or a node with no way out. */
  | "done";

/** A chart key: `null` is the main chart, a string names a routine. */
export type ChartKey = string | null;

export interface TraceEntry {
  chartKey: ChartKey;
  nodeId: string;
  /** The edge taken to *leave* this node; null while it is still current. */
  viaEdgeId: string | null;
  /** True when this node was reached by a connector jump rather than an arrow. */
  viaJump?: boolean;
  /** Marks the hop as crossing into, or back out of, a routine. */
  call?: "enter" | "return";
}

/**
 * A line in the console. Kept apart rather than flattened to strings so the
 * console can distinguish what the program printed from what you typed —
 * otherwise `5` and `5` look identical.
 */
export interface OutputLine {
  kind: "output" | "input" | "error";
  text: string;
  /** Step the line was produced at, for context in the console gutter. */
  step: number;
}

/** One suspended caller, waiting for the routine it invoked to finish. */
export interface Frame {
  /** Chart holding the call site. */
  chartKey: ChartKey;
  /** The subroutine node to resume at. */
  nodeId: string;
  /** Routine that was entered, for the call-stack display. */
  callee: string;
  /** Variable the call's result is assigned to on return, if any. */
  assignTo?: string;
}

export interface RunState {
  status: RunStatus;
  /** Chart the trace is currently inside. */
  chartKey: ChartKey;
  currentId: string | null;
  trace: TraceEntry[];
  /** Callers suspended below the current chart, outermost first. */
  stack: Frame[];
  /** Branches offered at the current node when status is "awaiting". */
  choices: FlowEdgeSpec[];
  /**
   * Variable bindings, one frame per entry and innermost last. A routine gets
   * a fresh scope holding only its parameters, so it cannot see the caller's
   * variables — which is the point of having parameters at all.
   */
  scopes: Scope[];
  /** Console lines, oldest first. */
  output: OutputLine[];
  /** Variable an input shape is waiting to fill, when status is "input". */
  awaitingInput: string | null;
  /** Set when the run stopped because evaluating a shape failed. */
  errored: boolean;
  steps: number;
  message: string | null;
}

/**
 * Loops are legal in flowcharts, so a runaway trace is a real possibility.
 * Stop rather than freeze the tab.
 *
 * Sized so an ordinary counted loop finishes: FizzBuzz spends about six steps
 * per iteration, so 500 was falsely accusing any limit past ~85 of looping
 * forever. The guard cannot actually tell the two cases apart, so the message
 * no longer claims to.
 */
const MAX_STEPS = 20000;

/** Guards against a routine that calls itself without a base case. */
const MAX_DEPTH = 12;

export const INITIAL_RUN: RunState = {
  status: "idle",
  chartKey: null,
  currentId: null,
  trace: [],
  stack: [],
  choices: [],
  scopes: [{}],
  output: [],
  awaitingInput: null,
  errored: false,
  steps: 0,
  message: null,
};

function outgoingFrom(spec: FlowchartSpec, nodeId: string): FlowEdgeSpec[] {
  return spec.edges.filter((e) => e.source === nodeId);
}

function nodeAt(doc: FlowchartDocument, chartKey: ChartKey, nodeId: string | null) {
  const spec = chartOf(doc, chartKey);
  if (!spec || !nodeId) return null;
  return spec.nodes.find((n) => n.id === nodeId) ?? null;
}

/**
 * Prefix directives for I/O and returns. The lookahead is load-bearing: the
 * keyword must be followed by whitespace, an open paren, or the end of the
 * text, so `printer = 5` stays an assignment instead of printing `er = 5`.
 */
const PRINT_FORM = /^(?:print|output|display|write|show)(?=$|[\s(])\s*(.*)$/i;
const READ_FORM = /^(?:read|input|get|ask(?:\s+for)?)\s+([A-Za-z_]\w*)\s*$/i;
const RETURN_FORM = /^return(?=$|[\s(])\s*(.*)$/i;

/** Branch labels that mean true / false, for auto-taken decisions. */
const TRUE_LABELS = new Set(["yes", "y", "true", "t"]);
const FALSE_LABELS = new Set(["no", "n", "false", "f"]);

/** The source text to execute for a node, or null when it is prose. */
function sourceFor(node: FlowNodeSpec): string | null {
  if (node.expr !== undefined) return node.expr.trim() || null;
  return node.label.trim() || null;
}

/**
 * Parse a node's code.
 *
 * An explicit `expr` is taken at its word. A *label* has to look like more
 * than a lone name to count — "Start" and "A" parse as bare variable
 * references, and treating those as code would fail every terminator with
 * "Start has no value yet".
 */
function codeFor(node: FlowNodeSpec): Statement | null {
  const source = sourceFor(node);
  if (!source) return null;
  const statement = parseStatement(source);
  if (!statement) return null;
  if (node.expr === undefined && isBareReference(statement)) return null;
  return statement;
}

function scopeOf(state: RunState): Scope {
  return state.scopes[state.scopes.length - 1] ?? {};
}

/**
 * Evaluation context. Calls to routines are not resolved here — a routine is
 * a whole chart the runner has to walk, so `evaluate` only handles calls the
 * document does not define, which is to say none.
 */
function contextFor(doc: FlowchartDocument, state: RunState) {
  return {
    scope: scopeOf(state),
    call: (name: string, args: Value[]) => {
      const builtin = callBuiltin(name, args);
      if (builtin !== undefined) return builtin;
      // Routines are whole charts the runner walks; the evaluator cannot do
      // that mid-expression. Say so, rather than "no routine called X" when
      // the routine plainly exists.
      if (doc.routines[name]) {
        throw new ExprError(
          `"${name}" is a routine — call it from a subroutine shape, not from inside this expression.`,
        );
      }
      return undefined;
    },
  };
}

function errored(state: RunState, message: string): RunState {
  return {
    ...state,
    status: "done",
    errored: true,
    choices: [],
    message,
    // Mirror the failure into the console so the run's story reads in order.
    output: [...state.output, { kind: "error", text: message, step: state.steps }],
  };
}

/** Run a node's code for its side effect, returning the updated scope. */
function applyStatement(doc: FlowchartDocument, state: RunState, statement: Statement): Scope {
  const scope = scopeOf(state);
  const ctx = contextFor(doc, state);
  if (statement.kind === "assign") {
    return { ...scope, [statement.target]: evaluate(statement.value, ctx) };
  }
  evaluate(statement.value, ctx);
  return scope;
}

function withScope(state: RunState, scope: Scope): RunState {
  const scopes = [...state.scopes];
  scopes[scopes.length - 1] = scope;
  return { ...state, scopes };
}

/** The value a decision evaluates to, or null when it has no usable code. */
function decisionValue(doc: FlowchartDocument, state: RunState, node: FlowNodeSpec): Value | null {
  const statement = codeFor(node);
  if (!statement || statement.kind !== "expression") return null;
  return evaluate(statement.value, contextFor(doc, state));
}

/**
 * The branch a decision's value selects, or null to fall back to asking.
 *
 * A boolean picks the Yes/No arrow; anything else matches an arrow whose
 * label equals the value, which covers multi-way decisions written as a
 * switch. An unmatched value is not an error — the user is simply asked.
 */
function branchFor(value: Value, out: FlowEdgeSpec[]): FlowEdgeSpec | null {
  const labelOf = (edge: FlowEdgeSpec) => edge.label.trim().toLowerCase();
  if (typeof value === "boolean") {
    const wanted = value ? TRUE_LABELS : FALSE_LABELS;
    return out.find((edge) => wanted.has(labelOf(edge))) ?? null;
  }
  const text = stringify(value).toLowerCase();
  return out.find((edge) => labelOf(edge) === text) ?? null;
}

/**
 * Where a connector jumps to, if anywhere.
 *
 * A connector pair is deliberately drawn with no arrow between the halves —
 * that is the point of the notation. So a connector with no outgoing arrow is
 * not a dead end: control resumes at the matching connector that does have
 * one. Returns null for any connector that has its own outgoing arrow (it is
 * flowing normally, not jumping) or has no usable partner.
 */
function connectorJump(spec: FlowchartSpec, node: FlowNodeSpec): FlowNodeSpec | null {
  if (node.kind !== "connector") return null;
  if (outgoingFrom(spec, node.id).length > 0) return null;

  const key = connectorKey(node.label);
  return (
    spec.nodes.find(
      (candidate) =>
        candidate.id !== node.id &&
        candidate.kind === "connector" &&
        connectorKey(candidate.label) === key &&
        outgoingFrom(spec, candidate.id).length > 0,
    ) ?? null
  );
}

/**
 * The routine a subroutine node is about to enter, or null.
 *
 * Returns null when the trace has just come back out of that routine —
 * otherwise stepping off the call site would immediately re-enter it.
 */
function pendingCall(doc: FlowchartDocument, state: RunState, node: FlowNodeSpec): string | null {
  if (node.kind !== "subroutine") return null;
  if (!calleeOf(doc, node)) return null;

  const last = state.trace[state.trace.length - 1];
  const justReturned =
    last?.call === "return" && last.nodeId === node.id && last.chartKey === state.chartKey;
  return justReturned ? null : calleeOf(doc, node);
}

/**
 * Which routine a subroutine shape calls.
 *
 * An explicit `calls` wins, but writing `validate(limit)` as the shape's code
 * is the obvious way to express a call, so a call naming a routine in the
 * document resolves too — otherwise the link is invisible and unset-able.
 */
export function calleeOf(doc: FlowchartDocument, node: FlowNodeSpec): string | null {
  if (node.kind !== "subroutine") return null;
  if (node.calls && doc.routines[node.calls]) return node.calls;

  const statement = codeFor(node);
  if (!statement) return null;
  const value = statement.kind === "assign" ? statement.value : statement.value;
  if (value.kind === "call" && doc.routines[value.name]) return value.name;
  return null;
}

/** Enter the chart at its start terminator, or the first node if there is none. */
export function startRun(doc: FlowchartDocument): RunState {
  const entry = doc.main.nodes.find((n) => n.kind === "start") ?? doc.main.nodes[0];
  if (!entry) {
    return { ...INITIAL_RUN, status: "done", message: "Nothing on the board to run." };
  }

  return settle(doc, {
    ...INITIAL_RUN,
    status: "running",
    chartKey: null,
    currentId: entry.id,
    trace: [{ chartKey: null, nodeId: entry.id, viaEdgeId: null }],
  });
}

/**
 * Decide what the run is waiting on now that the position has moved. Splitting
 * this out keeps the transitions from duplicating the terminal checks.
 */
function settle(doc: FlowchartDocument, state: RunState): RunState {
  const spec = chartOf(doc, state.chartKey);
  const node = nodeAt(doc, state.chartKey, state.currentId);
  if (!spec || !node) return { ...state, status: "done", message: "Trace left the chart." };

  const out = outgoingFrom(spec, node.id);

  // A call is a move even though no arrow leaves the node yet.
  if (pendingCall(doc, state, node)) {
    return { ...state, status: "running", choices: [], message: null };
  }

  if (out.length === 0) {
    if (connectorJump(spec, node)) {
      return { ...state, status: "running", choices: [], message: null };
    }
    if (state.stack.length > 0) {
      // Inside a routine: reaching the end returns to the caller.
      return { ...state, status: "running", choices: [], message: null };
    }
    return {
      ...state,
      status: "done",
      choices: [],
      message:
        node.kind === "end"
          ? "Reached the end terminator."
          : node.kind === "connector"
            ? `Connector "${node.label}" has no matching connector to jump to.`
            : `"${node.label}" has no outgoing arrow — the trace stops here.`,
    };
  }

  if (out.length > 1) {
    // A decision with runnable code takes its own branch; one with a prose
    // condition, or a value no arrow covers, still asks the reader.
    try {
      const value = decisionValue(doc, state, node);
      if (value !== null && branchFor(value, out)) {
        return { ...state, status: "running", choices: [], message: null };
      }
    } catch (cause) {
      if (cause instanceof ExprError) {
        return errored(state, `"${node.label}" could not be evaluated — ${cause.message}`);
      }
      throw cause;
    }
    return { ...state, status: "awaiting", choices: out, message: null };
  }

  return { ...state, status: "running", choices: [], message: null };
}

/**
 * Do whatever this shape does — assign, print, ask for input — and return the
 * updated state. Shapes whose text is prose do nothing, which is what keeps a
 * chart transcribed from an image working exactly as before.
 *
 * Throws ExprError; callers turn that into a stopped run with a message.
 */
function perform(doc: FlowchartDocument, state: RunState, node: FlowNodeSpec): RunState {
  const source = sourceFor(node);

  if (node.kind === "io" && source) {
    const read = READ_FORM.exec(source);
    if (read) {
      // Park until a value is supplied; supplyInput binds it and resumes.
      return { ...state, status: "input", awaitingInput: read[1], choices: [], message: null };
    }
    const printed = PRINT_FORM.exec(source);
    if (printed) {
      const text = printed[1].trim();
      const value = text ? evaluate(parseOrThrow(text), contextFor(doc, state)) : "";
      return {
        ...state,
        output: [...state.output, { kind: "output", text: stringify(value), step: state.steps }],
      };
    }
  }

  // A routine's end shape is handled at return time, not here.
  if (node.kind === "end" && source && RETURN_FORM.test(source)) return state;

  // Likewise a call site: entering bound the arguments and returning assigned
  // the result, so re-running `ok = validate(limit)` here would try to
  // evaluate the call as ordinary code and fail — the evaluator has no idea
  // how to walk a whole chart.
  if (node.kind === "subroutine") return state;

  const statement = codeFor(node);
  if (!statement) return state;
  return withScope(state, applyStatement(doc, state, statement));
}

function parseOrThrow(source: string) {
  const node = parseExpression(source);
  if (!node) throw new ExprError(`"${source}" is not an expression.`);
  return node;
}

/** The arguments and assignment target written on a subroutine shape. */
function callArguments(
  doc: FlowchartDocument,
  state: RunState,
  node: FlowNodeSpec,
): { args: Value[]; assignTo?: string } {
  const statement = codeFor(node);
  if (!statement) return { args: [] };

  const assignTo = statement.kind === "assign" ? statement.target : undefined;
  const value = statement.kind === "assign" ? statement.value : statement.value;
  if (value.kind !== "call") return { args: [], assignTo };

  const ctx = contextFor(doc, state);
  return { args: value.args.map((arg) => evaluate(arg, ctx)), assignTo };
}

/** A routine's fresh scope: its parameters, and nothing from the caller. */
function bindParams(params: string[], args: Value[]): Scope {
  if (args.length && params.length && args.length !== params.length) {
    throw new ExprError(`expected ${params.length} argument(s) but got ${args.length}.`);
  }
  const scope: Scope = {};
  params.forEach((name, index) => {
    // A call written without arguments still enters; its parameters start
    // unset, which surfaces later as a clear "has no value yet".
    if (index < args.length) scope[name] = args[index];
  });
  return scope;
}

/**
 * The value the routine is returning, read off the end shape it stopped on
 * and evaluated in the routine's own scope before that scope is discarded.
 */
function returnValue(doc: FlowchartDocument, state: RunState): Value | null {
  const node = nodeAt(doc, state.chartKey, state.currentId);
  const source = node && sourceFor(node);
  if (!source) return null;

  const returned = RETURN_FORM.exec(source);
  const text = returned ? returned[1].trim() : null;
  if (!text) return null;

  return evaluate(parseOrThrow(text), contextFor(doc, state));
}

function capped(state: RunState): RunState {
  return {
    ...state,
    status: "done",
    choices: [],
    message: `Stopped after ${MAX_STEPS} steps — the trace either loops forever or is longer than the board will walk.`,
  };
}

/** Follow one edge to the node it points at. */
function traverse(doc: FlowchartDocument, state: RunState, edge: FlowEdgeSpec): RunState {
  if (state.steps >= MAX_STEPS) return capped(state);

  const trace = [...state.trace];
  if (trace.length > 0) trace[trace.length - 1] = { ...trace[trace.length - 1], viaEdgeId: edge.id };
  trace.push({ chartKey: state.chartKey, nodeId: edge.target, viaEdgeId: null });

  return settle(doc, {
    ...state,
    currentId: edge.target,
    trace,
    steps: state.steps + 1,
    choices: [],
  });
}

/** Follow a connector jump, which crosses no arrow but still costs a step. */
function jump(doc: FlowchartDocument, state: RunState, targetId: string): RunState {
  if (state.steps >= MAX_STEPS) return capped(state);

  const trace = [
    ...state.trace,
    { chartKey: state.chartKey, nodeId: targetId, viaEdgeId: null, viaJump: true },
  ];
  return settle(doc, { ...state, currentId: targetId, trace, steps: state.steps + 1, choices: [] });
}

/** Push a frame and continue at the start of the routine being called. */
function enterRoutine(doc: FlowchartDocument, state: RunState, callee: string): RunState {
  if (state.steps >= MAX_STEPS) return capped(state);
  if (state.stack.length >= MAX_DEPTH) {
    return {
      ...state,
      status: "done",
      choices: [],
      message: `Stopped ${MAX_DEPTH} calls deep — this looks like runaway recursion.`,
    };
  }

  const routine = doc.routines[callee];
  const entry = routine.nodes.find((n) => n.kind === "start") ?? routine.nodes[0];
  if (!entry) {
    return {
      ...state,
      status: "done",
      choices: [],
      message: `Routine "${callee}" is empty — there is nothing to run.`,
    };
  }

  // Bind the call's arguments to the routine's parameters in a fresh scope.
  const call = callArguments(doc, state, nodeAt(doc, state.chartKey, state.currentId)!);
  let bound: Scope;
  try {
    bound = bindParams(routine.params ?? [], call.args);
  } catch (cause) {
    if (cause instanceof ExprError) return errored(state, `Calling ${callee} failed — ${cause.message}`);
    throw cause;
  }

  const frame: Frame = {
    chartKey: state.chartKey,
    nodeId: state.currentId!,
    callee,
    assignTo: call.assignTo,
  };
  return settle(doc, {
    ...state,
    chartKey: callee,
    currentId: entry.id,
    scopes: [...state.scopes, bound],
    stack: [...state.stack, frame],
    trace: [...state.trace, { chartKey: callee, nodeId: entry.id, viaEdgeId: null, call: "enter" }],
    steps: state.steps + 1,
    choices: [],
  });
}

/** Pop back to the caller and land on the call site again. */
function returnToCaller(doc: FlowchartDocument, state: RunState): RunState {
  if (state.steps >= MAX_STEPS) return capped(state);

  const stack = [...state.stack];
  const frame = stack.pop()!;

  // The routine's end shape supplies the value, evaluated in its own scope
  // before that scope is discarded.
  let returned: Value | null = null;
  try {
    returned = returnValue(doc, state);
  } catch (cause) {
    if (cause instanceof ExprError) {
      return errored(state, `Returning from ${frame.callee} failed — ${cause.message}`);
    }
    throw cause;
  }

  const scopes = state.scopes.slice(0, -1);
  if (frame.assignTo) {
    const caller = scopes[scopes.length - 1] ?? {};
    scopes[scopes.length - 1] = { ...caller, [frame.assignTo]: returned ?? false };
  }

  return settle(doc, {
    ...state,
    chartKey: frame.chartKey,
    currentId: frame.nodeId,
    scopes,
    stack,
    trace: [
      ...state.trace,
      { chartKey: frame.chartKey, nodeId: frame.nodeId, viaEdgeId: null, call: "return" },
    ],
    steps: state.steps + 1,
    choices: [],
  });
}

/**
 * Advance one node. A no-op when the run is waiting on a branch choice —
 * call `choose` instead.
 */
export function step(doc: FlowchartDocument, state: RunState): RunState {
  if (state.status === "idle") return startRun(doc);
  if (state.status === "done" || state.status === "awaiting") return state;

  const spec = chartOf(doc, state.chartKey);
  const node = nodeAt(doc, state.chartKey, state.currentId);
  if (!spec || !node) return settle(doc, state);

  const callee = pendingCall(doc, state, node);
  if (callee) return enterRoutine(doc, state, callee);

  // Run whatever this shape does, then move. Doing the effect on the way out
  // means the highlighted shape is the one about to happen, not the one that
  // already did — you can predict it, then step and watch.
  let acted: RunState;
  try {
    acted = perform(doc, state, node);
  } catch (cause) {
    if (cause instanceof ExprError) {
      return errored(state, `"${node.label}" could not be run — ${cause.message}`);
    }
    throw cause;
  }
  // An input shape parks here until a value arrives.
  if (acted.status === "input") return acted;

  const out = outgoingFrom(spec, node.id);

  if (out.length === 0) {
    const landing = connectorJump(spec, node);
    if (landing) return jump(doc, acted, landing.id);
    if (acted.stack.length > 0) return returnToCaller(doc, acted);
    return settle(doc, acted);
  }

  if (out.length > 1) {
    try {
      const value = decisionValue(doc, acted, node);
      const branch = value === null ? null : branchFor(value, out);
      if (branch) return traverse(doc, acted, branch);
    } catch (cause) {
      if (cause instanceof ExprError) {
        return errored(acted, `"${node.label}" could not be evaluated — ${cause.message}`);
      }
      throw cause;
    }
    return settle(doc, acted);
  }

  return traverse(doc, acted, out[0]);
}

/**
 * Supply the value an input shape is waiting for, then continue from it.
 *
 * The shape has already been "performed" — it parked rather than acting — so
 * binding the value and re-stepping runs the rest of the move normally.
 */
export function supplyInput(doc: FlowchartDocument, state: RunState, text: string): RunState {
  if (state.status !== "input" || !state.awaitingInput) return state;

  const scope = { ...scopeOf(state), [state.awaitingInput]: coerceInput(text) };
  const resumed: RunState = {
    ...withScope(state, scope),
    status: "running",
    awaitingInput: null,
    output: [
      ...state.output,
      { kind: "input", text: `${state.awaitingInput} = ${text.trim()}`, step: state.steps },
    ],
  };

  // Move off the input shape. `perform` is a no-op for it now that the
  // variable is bound, so this just follows the outgoing arrow.
  const spec = chartOf(doc, resumed.chartKey);
  const node = nodeAt(doc, resumed.chartKey, resumed.currentId);
  if (!spec || !node) return settle(doc, resumed);
  const out = outgoingFrom(spec, node.id);
  if (out.length === 1) return traverse(doc, resumed, out[0]);
  return settle(doc, resumed);
}

/** Resolve a decision by taking the named branch. */
export function choose(doc: FlowchartDocument, state: RunState, edgeId: string): RunState {
  const edge = state.choices.find((e) => e.id === edgeId);
  if (!edge) return state;
  return traverse(doc, state, edge);
}

/** How many times the trace has entered each node of one chart. */
export function visitCounts(state: RunState, chartKey: ChartKey): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of state.trace) {
    if (entry.chartKey !== chartKey) continue;
    counts.set(entry.nodeId, (counts.get(entry.nodeId) ?? 0) + 1);
  }
  return counts;
}

/** Edges walked so far within one chart, for highlighting. */
export function takenEdgeIds(state: RunState, chartKey: ChartKey): Set<string> {
  const ids = new Set<string>();
  for (const entry of state.trace) {
    if (entry.chartKey === chartKey && entry.viaEdgeId) ids.add(entry.viaEdgeId);
  }
  return ids;
}

/** Just the printed text, for tests and copy-to-clipboard. */
export function outputText(state: RunState): string[] {
  return state.output.filter((line) => line.kind === "output").map((line) => line.text);
}

/** Call sites currently suspended in a given chart, shown as "waiting". */
export function waitingNodeIds(state: RunState, chartKey: ChartKey): Set<string> {
  const ids = new Set<string>();
  for (const frame of state.stack) {
    if (frame.chartKey === chartKey) ids.add(frame.nodeId);
  }
  return ids;
}
