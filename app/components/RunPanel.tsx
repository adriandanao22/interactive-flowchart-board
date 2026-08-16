"use client";

import { useState } from "react";

import { stringify } from "@/lib/expr";
import { chartOf, type FlowchartDocument, type LintWarning } from "@/lib/flowchart";
import type { ChartKey, RunState } from "@/lib/runner";

interface Props {
  doc: FlowchartDocument;
  run: RunState;
  playing: boolean;
  warnings: LintWarning[];
  onStep: () => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onChoose: (edgeId: string) => void;
  onSupplyInput: (text: string) => void;
  onFocusNode: (id: string) => void;
}

export function RunPanel({
  doc,
  run,
  playing,
  warnings,
  onStep,
  onTogglePlay,
  onReset,
  onChoose,
  onSupplyInput,
  onFocusNode,
}: Props) {
  const labelIn = (chartKey: ChartKey, id: string) =>
    chartOf(doc, chartKey)?.nodes.find((n) => n.id === id)?.label ?? id;
  /** Labels for the chart the run is in right now. */
  const labelOf = (id: string) => labelIn(run.chartKey, id);
  const current = run.currentId ? labelOf(run.currentId) : null;
  const routineTitle = (key: string) => chartOf(doc, key)?.title || key;
  const finished = run.status === "done";
  // While a branch is pending, choosing one is the only move — and playback
  // picks itself back up automatically once the choice is made.
  const blocked = finished || run.status === "awaiting" || run.status === "input";
  const variables = Object.entries(run.scopes[run.scopes.length - 1] ?? {});

  return (
    // shrink-0: without it this panel is compressed below its content height
    // as the trace grows, and the text spills over the panels above.
    <div className="flex shrink-0 flex-col gap-3 px-5 pb-3">
      <span className="font-mono text-[11px] tabular-nums text-muted-fg">
        step {run.steps}
      </span>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={blocked}
          className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
        >
          {playing ? "Pause" : run.status === "idle" ? "Run" : "Play"}
        </button>
        <button
          type="button"
          onClick={onStep}
          disabled={blocked}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
          title={run.status === "awaiting" ? "Pick a branch below first" : "Advance one node"}
        >
          Step
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
        >
          Reset
        </button>
      </div>

      {current && (
        <p className="text-sm">
          <span className="text-muted-fg">At: </span>
          <span className="font-medium">{current}</span>
          {run.chartKey && (
            <span className="text-muted-fg"> in {routineTitle(run.chartKey)}</span>
          )}
        </p>
      )}

      {run.stack.length > 0 && (
        <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            Call stack
          </p>
          <ol className="mt-1 space-y-0.5 text-xs">
            <li className="text-muted-fg">{doc.main.title || "main"}</li>
            {run.stack.map((frame, depth) => (
              <li key={`${frame.chartKey ?? "main"}:${frame.nodeId}`} style={{ paddingLeft: (depth + 1) * 10 }}>
                <span className="text-muted-fg">↳ </span>
                <span className={depth === run.stack.length - 1 ? "font-semibold text-accent" : ""}>
                  {routineTitle(frame.callee)}
                </span>
                <span className="text-muted-fg">
                  {" "}from “{labelIn(frame.chartKey, frame.nodeId)}”
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {run.status === "awaiting" && (
        <div className="rounded-md border border-accent/50 bg-accent/10 p-3">
          <p className="mb-2 text-xs font-semibold">Which branch does the condition take?</p>
          <div className="flex flex-wrap gap-2">
            {run.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => onChoose(choice.id)}
                className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg"
                title={`Go to "${labelOf(choice.target)}"`}
              >
                {choice.label || "(unlabelled)"}
              </button>
            ))}
          </div>
        </div>
      )}

      {run.status === "input" && run.awaitingInput && (
        <InputPrompt variable={run.awaitingInput} onSubmit={onSupplyInput} />
      )}

      {variables.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            Variables{run.chartKey ? ` in ${routineTitle(run.chartKey)}` : ""}
          </p>
          <ul className="max-h-28 space-y-0.5 overflow-y-auto font-mono text-xs">
            {variables.map(([name, value]) => (
              <li key={name} className="flex justify-between gap-3">
                <span className="text-muted-fg">{name}</span>
                <span className="truncate font-semibold">{stringify(value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.message && (
        <p
          className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${
            run.errored
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-line bg-surface-muted"
          }`}
        >
          {run.message}
        </p>
      )}

      {run.trace.length > 0 && (
        <div className="min-h-0">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            Path taken
          </p>
          {/* Capped so a long trace scrolls here rather than growing the panel
              until it crowds out the inspector above. */}
          <ol className="max-h-44 space-y-0.5 overflow-y-auto text-xs">
            {run.trace.map((entry, index) => {
              const isLast = index === run.trace.length - 1;
              const via = entry.viaEdgeId
                ? chartOf(doc, entry.chartKey)?.edges.find((e) => e.id === entry.viaEdgeId)?.label
                : null;
              return (
                <li key={`${entry.nodeId}-${index}`}>
                  <button
                    type="button"
                    onClick={() => entry.chartKey === null && onFocusNode(entry.nodeId)}
                    className={`w-full rounded px-1.5 py-0.5 text-left hover:bg-surface-muted ${
                      isLast ? "font-semibold text-accent" : "text-muted-fg"
                    }`}
                  >
                    <span className="mr-1.5 font-mono tabular-nums opacity-60">{index + 1}.</span>
                    {entry.viaJump && <span className="mr-1 opacity-70">↷</span>}
                    {entry.call === "enter" && <span className="mr-1 opacity-70">⤵</span>}
                    {entry.call === "return" && <span className="mr-1 opacity-70">⤴</span>}
                    {labelIn(entry.chartKey, entry.nodeId)}
                    {entry.chartKey && (
                      <span className="ml-1 opacity-60">({routineTitle(entry.chartKey)})</span>
                    )}
                    {via && <span className="ml-1 opacity-70">— took “{via}”</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="rounded-md border border-line bg-surface-muted px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold">
            {warnings.length} structural {warnings.length === 1 ? "warning" : "warnings"}
          </summary>
          <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4 text-xs leading-relaxed text-muted-fg">
            {warnings.map((warning) => (
              <li key={warning.id}>
                {warning.nodeId && !warning.chartKey ? (
                  // Two shapes can share a label, so let the reader jump to the
                  // one actually at fault instead of guessing. Only main-chart
                  // warnings are clickable — the canvas cannot pan to a routine.
                  <button
                    type="button"
                    onClick={() => onFocusNode(warning.nodeId!)}
                    className="text-left hover:text-foreground hover:underline"
                    title="Show this shape on the board"
                  >
                    {warning.message}
                  </button>
                ) : (
                  warning.message
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Asks for the value an input shape is waiting on. */
function InputPrompt({
  variable,
  onSubmit,
}: {
  variable: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <form
      className="rounded-md border border-accent/50 bg-accent/10 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text);
      }}
    >
      <label className="mb-2 block text-xs font-semibold" htmlFor="run-input">
        Value for <code className="font-mono">{variable}</code>
      </label>
      <div className="flex gap-2">
        <input
          id="run-input"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. 15"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg"
        >
          Enter
        </button>
      </div>
    </form>
  );
}
