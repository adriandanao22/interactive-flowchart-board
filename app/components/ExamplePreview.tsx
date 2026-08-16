"use client";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { layoutSpec } from "@/lib/layout";
import {
  INITIAL_RUN,
  choose,
  startRun,
  step,
  supplyInput,
  takenEdgeIds,
  visitCounts,
  type RunState,
} from "@/lib/runner";
import type { FlowchartDocument } from "@/lib/flowchart";
import type { GuideExample } from "@/lib/guide";

import { ShapeNode, type NodeRunState } from "./ShapeNode";

const nodeTypes: NodeTypes = { flowShape: ShapeNode };
const PLAY_INTERVAL_MS = 850;

interface Props {
  example: GuideExample;
  /** Offered as a secondary action, so an example can still be tinkered with. */
  onOpenOnBoard: (doc: FlowchartDocument) => void;
  canAddNew: boolean;
  onClose: () => void;
}

/**
 * A worked example, running, without leaving the guide.
 *
 * Read-only on purpose: this is for watching, and anyone who wants to change
 * it can put it on the board. The canvas follows the run into a subroutine
 * rather than showing only the main chart, so a call is something you see
 * happen instead of something the text has to describe.
 *
 * Full-bleed on a phone. A centred dialog inside another dialog would leave a
 * flowchart perhaps 240px wide, which is not enough to read one.
 */
export function ExamplePreview({ example, onOpenOnBoard, canAddNew, onClose }: Props) {
  const doc = example.doc;
  const [run, setRun] = useState<RunState>(INITIAL_RUN);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Whichever chart the run is currently inside — the main one before it
  // starts, and a routine's body while it is in there.
  const shownKey = run.status === "idle" ? null : run.chartKey;
  const spec = (shownKey === null ? doc.main : doc.routines[shownKey]) ?? doc.main;

  const laid = useMemo(() => layoutSpec(spec), [spec]);

  const nodes = useMemo(() => {
    const states = new Map<string, NodeRunState>();
    for (const entry of run.trace) {
      if (entry.chartKey === shownKey) states.set(entry.nodeId, "visited");
    }
    if (run.currentId && run.chartKey === shownKey) states.set(run.currentId, "current");
    const counts = visitCounts(run, shownKey);

    return laid.nodes.map((node) => ({
      ...node,
      draggable: false,
      data: {
        ...node.data,
        runState: states.get(node.id) ?? "none",
        visits: counts.get(node.id) ?? 0,
      },
    }));
  }, [laid.nodes, run, shownKey]);

  const edges = useMemo(() => {
    const taken = takenEdgeIds(run, shownKey);
    const offered = new Set(run.chartKey === shownKey ? run.choices.map((c) => c.id) : []);

    return laid.edges.map((edge) => {
      const highlighted = offered.has(edge.id) || taken.has(edge.id);
      return {
        ...edge,
        className: offered.has(edge.id) ? "edge-choice" : taken.has(edge.id) ? "edge-taken" : "",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: highlighted ? "var(--edge-taken)" : "var(--edge)",
        },
      };
    });
  }, [laid.edges, run, shownKey]);

  // Auto-play stops itself the moment the run needs a human, so it cannot spin
  // against a prompt nobody has answered.
  const canAdvance = run.status === "idle" || run.status === "running";
  const actuallyPlaying = playing && canAdvance;

  useEffect(() => {
    if (!actuallyPlaying) return;
    const timer = setInterval(() => {
      setRun((prev) => (prev.status === "idle" ? startRun(doc) : step(doc, prev)));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [actuallyPlaying, doc]);

  // `playing` is deliberately left alone when the run blocks on a prompt:
  // `actuallyPlaying` already stops the timer, and keeping the intent means
  // answering the question resumes playback instead of needing Play again.

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus the box the moment the run asks for something, so a keyboard user
  // does not have to hunt for it.
  useEffect(() => {
    if (run.status === "input") inputRef.current?.focus();
  }, [run.status]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [run.output]);

  function doStep() {
    setRun((prev) => (prev.status === "idle" ? startRun(doc) : step(doc, prev)));
  }

  function reset() {
    setPlaying(false);
    setAnswer("");
    setRun(INITIAL_RUN);
  }

  function send() {
    if (!answer.trim() && run.status === "input") return;
    setRun((prev) => supplyInput(doc, prev, answer));
    setAnswer("");
  }

  const done = run.status === "done";

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Example: ${example.title}`}
        className="flex h-full w-full flex-col overflow-hidden border-line bg-surface md:h-[min(44rem,90vh)] md:max-w-3xl md:rounded-xl md:border md:shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-3 py-2.5 md:px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{example.title}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-fg">
              {shownKey === null ? example.blurb : `inside the routine ${spec.title}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mt-0.5 shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            Close
          </button>
        </header>

        {/* The chart takes every pixel the controls do not need. */}
        <div className="min-h-0 flex-1">
          <ReactFlowProvider>
            <ReactFlow
              // Remount per chart so fitView reframes when the run steps into
              // a routine, instead of keeping the caller's viewport.
              key={shownKey ?? "__main"}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              // Required, not optional: every handle is declared type="source",
              // so in strict mode no targetHandle resolves and edges vanish.
              connectionMode={ConnectionMode.Loose}
              proOptions={{ hideAttribution: true }}
              minZoom={0.1}
              maxZoom={2}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              style={{ background: "var(--canvas)" }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1.2}
                color="var(--canvas-dot)"
              />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {/* ---- what it said ---- */}
        <div
          ref={outputRef}
          className="max-h-24 shrink-0 overflow-y-auto border-t border-line bg-surface-muted px-3 py-1.5 md:px-4"
        >
          {run.output.length === 0 ? (
            <p className="text-[11px] text-muted-fg">
              Press <b>Step</b> to move one shape at a time, or <b>Play</b> to watch it go.
            </p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px] leading-relaxed">
              {run.output.map((line, i) => (
                <li
                  key={i}
                  className={
                    line.kind === "error"
                      ? "text-danger"
                      : line.kind === "input"
                        ? "text-muted-fg"
                        : ""
                  }
                >
                  <span className="mr-1.5 opacity-60">
                    {line.kind === "error" ? "✕" : line.kind === "input" ? "‹" : "›"}
                  </span>
                  {line.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- controls ---- */}
        <div className="shrink-0 border-t border-line px-3 py-2 md:px-4">
          {run.status === "input" && (
            <form
              className="mb-2 flex gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
            >
              <input
                ref={inputRef}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={run.message ?? "Type your answer…"}
                className="min-h-9 min-w-0 flex-1 rounded-md border border-accent bg-surface-muted px-2.5 text-sm outline-none"
              />
              <button
                type="submit"
                className="min-h-9 shrink-0 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg"
              >
                Enter
              </button>
            </form>
          )}

          {run.status === "awaiting" && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] text-muted-fg">Which way does it go?</p>
              <div className="flex flex-wrap gap-1.5">
                {run.choices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => setRun((prev) => choose(doc, prev, choice.id))}
                    className="min-h-9 rounded-md border border-accent px-3 text-xs font-medium text-accent hover:bg-accent/10"
                  >
                    {choice.label || "(unlabelled)"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={doStep}
              disabled={!canAdvance}
              className="min-h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-surface-muted disabled:opacity-40"
            >
              Step
            </button>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              disabled={!canAdvance}
              className="min-h-9 rounded-md bg-accent px-3 text-xs font-medium text-accent-fg disabled:opacity-40"
            >
              {actuallyPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={run.status === "idle"}
              className="min-h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-surface-muted disabled:opacity-40"
            >
              Reset
            </button>

            {done && (
              <span className="text-[11px] font-medium text-muted-fg">
                Finished — {run.steps} step{run.steps === 1 ? "" : "s"}.
              </span>
            )}

            <button
              type="button"
              onClick={() => onOpenOnBoard(doc)}
              className="ml-auto min-h-9 rounded-md border border-line px-3 text-xs font-medium hover:bg-surface-muted"
              title={
                canAddNew
                  ? "Adds a copy to your charts so you can change it"
                  : "Puts a copy on the board, replacing what is there"
              }
            >
              Edit a copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
