"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { NodeKind } from "@/lib/flowchart";
import type { BoardNode } from "@/lib/layout";

import { ShapeOutline } from "./ShapeOutline";

/**
 * How the runner currently relates to this node.
 * "waiting" is a call site suspended while the routine it invoked runs.
 */
export type NodeRunState = "none" | "current" | "visited" | "waiting";

export interface ShapeNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  width: number;
  height: number;
  runState?: NodeRunState;
  /** Times the trace has entered this node; shown once it exceeds one. */
  visits?: number;
  /** Comments pinned to this shape, badged so they are findable. */
  comments?: number;
}

/** Horizontal room the label has inside each shape. */
const TEXT_PADDING: Record<NodeKind, string> = {
  start: "0 14px",
  end: "0 14px",
  process: "0 14px",
  decision: "0 48px",
  io: "0 24px",
  subroutine: "0 22px",
  connector: "0 4px",
  preparation: "0 30px",
};

function ShapeNodeImpl({ data, selected }: NodeProps<BoardNode>) {
  const { kind, label, width, height } = data as ShapeNodeData;
  const runState = (data as ShapeNodeData).runState ?? "none";
  const visits = (data as ShapeNodeData).visits ?? 0;
  const comments = (data as ShapeNodeData).comments ?? 0;

  return (
    <div
      className="relative"
      style={{
        width,
        height,
        // The glow is the run highlight; the ring is the selection highlight.
        filter:
          runState === "current"
            ? "drop-shadow(0 0 0 var(--run-glow)) drop-shadow(0 0 9px var(--run-glow))"
            : runState === "waiting"
              ? "drop-shadow(0 0 6px var(--waiting-glow))"
              : undefined,
        opacity: runState === "visited" ? 0.92 : 1,
      }}
    >
      {/* One handle centred on each side. All four are declared as sources:
          the board runs React Flow in Loose connection mode, where a target
          handle is looked up in the source list too, so every side works as
          both an entry and an exit. */}
      <Handle type="source" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Left} id="l" />

      <ShapeOutline kind={kind} width={width} height={height} />

      {selected && (
        <span
          className="pointer-events-none absolute rounded-lg"
          style={{
            inset: -6,
            outline: "2px solid var(--accent)",
            outlineOffset: 0,
            borderRadius: 10,
          }}
        />
      )}

      {/* leading-4.5 is 18px — keep it equal to LINE_HEIGHT in lib/layout.ts,
          which is what sizes the box to fit this text. */}
      <div
        className="relative flex h-full w-full items-center justify-center text-center leading-4.5"
        style={{
          padding: TEXT_PADDING[kind],
          color: `var(--${kind}-text)`,
          fontSize: kind === "connector" ? 14 : 13,
          fontWeight: 600,
          overflowWrap: "anywhere",
          // Line breaks the author typed are meaningful on a shape that sets
          // several things at once; `measureNode` sizes the box for them.
          whiteSpace: "pre-line",
        }}
      >
        {label}
      </div>

      {runState === "waiting" && (
        <span
          className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
          style={{ background: "var(--waiting-glow)", color: "var(--accent-fg)" }}
        >
          waiting
        </span>
      )}

      {visits > 1 && (
        <span
          className="absolute -top-2 -left-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
          title={`Entered ${visits} times`}
        >
          {visits}
        </span>
      )}

      {/* Opposite corner from the visit badge, so a shape that is both
          commented on and looped over shows the two without overlapping. */}
      {comments > 0 && (
        <span
          className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full px-1 text-[10px] font-bold tabular-nums"
          style={{ background: "var(--surface)", color: "var(--foreground)", border: "1.5px solid var(--accent)" }}
          title={`${comments} comment${comments === 1 ? "" : "s"} on this shape`}
        >
          <span aria-hidden>💬</span>
          {comments}
        </span>
      )}
    </div>
  );
}

export const ShapeNode = memo(ShapeNodeImpl);
