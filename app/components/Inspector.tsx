"use client";

import { parseStatement } from "@/lib/expr";
import {
  KIND_INFO,
  NODE_KINDS,
  TERMINATOR_KINDS,
  isTerminator,
  type FlowEdgeSpec,
  type FlowNodeSpec,
  type FlowchartSpec,
  type NodeKind,
} from "@/lib/flowchart";
import { DEFAULT_LABEL } from "@/lib/layout";

export type Selection =
  | { type: "node"; id: string }
  | { type: "edge"; id: string }
  | null;

interface Props {
  selection: Selection;
  node: FlowNodeSpec | null;
  edge: FlowEdgeSpec | null;
  /** Endpoint labels for the selected edge, for a readable "A → B" line. */
  edgeEnds: { source: string; target: string } | null;
  outgoing: { edge: FlowEdgeSpec; targetLabel: string }[];
  incoming: { edge: FlowEdgeSpec; sourceLabel: string }[];
  onRenameNode: (id: string, label: string) => void;
  onSetExpr: (id: string, expr: string) => void;
  onSetCalls: (id: string, callee: string) => void;
  /** Routines available to call, keyed as code refers to them. */
  routines: Record<string, FlowchartSpec>;
  /** Which routine the runner will actually enter, if any. */
  resolvedCallee: string | null;
  onRekindNode: (id: string, kind: NodeKind) => void;
  onDeleteNode: (id: string) => void;
  onRelabelEdge: (id: string, label: string) => void;
  onDeleteEdge: (id: string) => void;
}

const swatch = (kind: NodeKind) => ({
  background: `var(--${kind}-fill)`,
  borderColor: `var(--${kind}-stroke)`,
  color: `var(--${kind}-text)`,
});

export function Inspector({
  selection,
  node,
  edge,
  edgeEnds,
  outgoing,
  incoming,
  onRenameNode,
  onSetExpr,
  onSetCalls,
  routines,
  resolvedCallee,
  onRekindNode,
  onDeleteNode,
  onRelabelEdge,
  onDeleteEdge,
}: Props) {
  if (!selection || (!node && !edge)) {
    return (
      <div className="flex h-full flex-col justify-center gap-4 p-5 text-sm text-muted-fg">
        <p className="font-medium text-foreground">Nothing selected</p>
        <p>Click a shape to see what it means and edit it. Click an arrow to edit its condition.</p>
        <div className="mt-2 space-y-1.5">
          {NODE_KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-2.5">
              <span
                className="inline-block h-3.5 w-6 shrink-0 rounded-sm border"
                style={swatch(kind)}
              />
              <span className="text-xs">{KIND_INFO[kind].name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (edge) {
    return (
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            Arrow
          </p>
          <p className="mt-1 text-sm font-medium">
            {edgeEnds?.source} <span className="text-muted-fg">→</span> {edgeEnds?.target}
          </p>
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Condition</span>
          <input
            value={edge.label}
            onChange={(event) => onRelabelEdge(edge.id, event.target.value)}
            placeholder="e.g. Yes — leave blank for an unconditional arrow"
            className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>

        <p className="text-xs leading-relaxed text-muted-fg">
          Arrows leaving a decision need a condition so a reader knows which case each branch
          covers. Arrows leaving any other shape are unconditional and stay blank.
        </p>

        <button
          type="button"
          onClick={() => onDeleteEdge(edge.id)}
          className="mt-auto w-full rounded-md border border-line px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-muted"
        >
          Delete arrow
        </button>
      </div>
    );
  }

  if (!node) return null;
  const info = KIND_INFO[node.kind];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div>
        <span
          className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
          style={swatch(node.kind)}
        >
          {info.name}
        </span>
        <p className="mt-2 text-xs text-muted-fg">Drawn as a {info.shape.toLowerCase()}.</p>
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Label</span>
        <textarea
          value={node.label}
          onChange={(event) => onRenameNode(node.id, event.target.value)}
          rows={2}
          className="w-full resize-y rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      {/* A terminator's direction is not a different shape — it is the same
          stadium at the other end of the chart — so it gets a toggle rather
          than being buried in a list of eight. */}
      {isTerminator(node.kind) && (
        <fieldset className="block text-sm">
          <legend className="mb-1.5 block font-medium">Which end?</legend>
          <div className="flex gap-1.5">
            {TERMINATOR_KINDS.map((kind) => (
              <label
                key={kind}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium ${
                  node.kind === kind
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-line hover:bg-surface-muted"
                }`}
              >
                <input
                  type="radio"
                  name={`terminator-${node.id}`}
                  className="sr-only"
                  checked={node.kind === kind}
                  onChange={() => onRekindNode(node.id, kind)}
                />
                {DEFAULT_LABEL[kind]}
              </label>
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted-fg">
            The run begins at a {DEFAULT_LABEL.start} and finishes at an{" "}
            {DEFAULT_LABEL.end}. Switching also renames the shape, unless you
            have given it a label of your own.
          </span>
        </fieldset>
      )}

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Shape</span>
        <select
          value={node.kind}
          onChange={(event) => onRekindNode(node.id, event.target.value as NodeKind)}
          className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        >
          {NODE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_INFO[kind].name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted-fg">
          Change this if the image was read wrong.
        </span>
      </label>

      {/* Teaching copy sits below the controls. It is worth reading once; the
          label and shape pickers are worth reaching every time, and burying
          them under a paragraph put the shape picker off the bottom of the
          sidebar entirely. */}
      <div>
        <p className="text-sm leading-relaxed">{info.blurb}</p>
        <div className="mt-2 rounded-md border border-line bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            In code
          </p>
          <code className="font-mono text-xs">{info.example}</code>
        </div>
      </div>

      <CodeField node={node} onSetExpr={onSetExpr} />

      {node.kind === "subroutine" && (
        <div className="space-y-1.5">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Calls</span>
            <select
              value={node.calls ?? ""}
              onChange={(event) => onSetCalls(node.id, event.target.value)}
              className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">
                {resolvedCallee ? `From the code — ${resolvedCallee}` : "Not linked"}
              </option>
              {Object.entries(routines).map(([key, routine]) => (
                <option key={key} value={key}>
                  {routine.title || key} ({key})
                </option>
              ))}
            </select>
          </label>
          <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs leading-relaxed">
            {resolvedCallee ? (
              <>
                Steps into <code className="font-mono">{resolvedCallee}</code> and comes back here
                when it ends.
              </>
            ) : Object.keys(routines).length === 0 ? (
              <>
                No routines in this document yet. Add one with{" "}
                <span className="font-medium">+ Routine</span> in the bar above the canvas, then
                pick it here.
              </>
            ) : (
              <>
                Not linked, so the trace steps straight over this shape. Pick a routine above, or
                write a call like <code className="font-mono">validate(limit)</code> in Code.
              </>
            )}
          </p>
        </div>
      )}

      <div className="text-sm">
        <p className="mb-1.5 font-medium">Connections</p>
        <ul className="space-y-1 text-xs text-muted-fg">
          {incoming.length === 0 && <li>No arrows in.</li>}
          {incoming.map(({ edge: e, sourceLabel }) => (
            <li key={e.id}>
              ← <span className="text-foreground">{sourceLabel}</span>
              {e.label && <span className="text-accent"> ({e.label})</span>}
            </li>
          ))}
          {outgoing.length === 0 && <li>No arrows out.</li>}
          {outgoing.map(({ edge: e, targetLabel }) => (
            <li key={e.id}>
              →{" "}
              {e.label && <span className="font-semibold text-accent">{e.label}: </span>}
              <span className="text-foreground">{targetLabel}</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onDeleteNode(node.id)}
        className="mt-auto w-full rounded-md border border-line px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-muted"
      >
        Delete shape
      </button>
    </div>
  );
}

/** Placeholder showing the shape of code each kind expects. */
const CODE_HINT: Partial<Record<NodeKind, string>> = {
  process: "i = i + 1",
  decision: "i % 15 == 0",
  io: 'print i     — or —     read limit',
  subroutine: "ok = validate(limit)",
  end: "return result",
};

/**
 * The executable code for a shape.
 *
 * Start and connector shapes have nothing to run, so the field is hidden for
 * them. Everything else reports whether what is typed will actually run,
 * because "it silently did nothing" is the confusing failure here.
 */
function CodeField({
  node,
  onSetExpr,
}: {
  node: FlowNodeSpec;
  onSetExpr: (id: string, expr: string) => void;
}) {
  const hint = CODE_HINT[node.kind];
  if (!hint) return null;

  const source = node.expr ?? "";
  // With the box empty the label is reconsidered as code, so preview that.
  const effective = source.trim() || node.label;
  const runs = isRunnable(node.kind, effective, source.trim().length > 0);

  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">Code</span>
      <textarea
        value={source}
        onChange={(event) => onSetExpr(node.id, event.target.value)}
        rows={2}
        spellCheck={false}
        placeholder={hint}
        className="w-full resize-y rounded-md border border-line bg-surface-muted px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent"
      />
      <span className="mt-1 block text-xs text-muted-fg">
        {runs ? (
          <>
            Runs when the trace reaches this shape.
            {!source.trim() && " (read from the label)"}
          </>
        ) : (
          <>Treated as prose — the shape is stepped over, and decisions ask you.</>
        )}
      </span>
    </label>
  );
}

/** Mirrors the runner's rules closely enough to preview them. */
function isRunnable(kind: NodeKind, source: string, explicit: boolean): boolean {
  const text = source.trim();
  if (!text) return false;
  if (kind === "io" && /^(?:print|output|display|write|show)(?=$|[\s(])/i.test(text)) return true;
  if (kind === "io" && /^(?:read|input|get|ask)\s+[A-Za-z_]\w*$/i.test(text)) return true;
  if (kind === "end" && /^return(?=$|[\s(])/i.test(text)) return true;
  const statement = parseStatement(text);
  if (!statement) return false;
  // A lone name only counts as code when it was typed in deliberately.
  return explicit || !isBareStatement(statement);
}

function isBareStatement(statement: ReturnType<typeof parseStatement>): boolean {
  if (!statement || statement.kind !== "expression") return false;
  return statement.value.kind === "variable" || statement.value.kind === "literal";
}
