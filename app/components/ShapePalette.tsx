"use client";

import { Panel } from "@xyflow/react";

import { KIND_INFO, PALETTE_KINDS, type NodeKind } from "@/lib/flowchart";

import { ShapeOutline } from "./ShapeOutline";

/** Drag payload type, so a shape drag is distinguishable from a file drop. */
export const SHAPE_DRAG_MIME = "application/x-flowchart-kind";

interface Props {
  onAdd: (kind: NodeKind) => void;
  tool: "select" | "pan";
  onToolChange: (tool: "select" | "pan") => void;
  /** Touch-only: tapping shapes adds to the selection instead of replacing it. */
  multiSelect: boolean;
  onMultiSelectChange: (value: boolean) => void;
  /**
   * Lay out along the top instead of down the side. A column of nine buttons
   * takes most of a phone's canvas height; a scrolling row costs one band.
   */
  compact?: boolean;
}

const PREVIEW_W = 34;
const PREVIEW_H = 22;

/**
 * Floating palette. Click to drop a shape into the middle of the view, or drag
 * one onto the canvas to place it exactly.
 *
 * Seven buttons for eight kinds: start and end are the same drawn shape, so
 * they share an entry and the board picks the direction. Two identical
 * stadiums side by side told the reader nothing the colours did not.
 */
export function ShapePalette({
  onAdd,
  tool,
  onToolChange,
  multiSelect,
  onMultiSelectChange,
  compact = false,
}: Props) {
  // Deliberately not `top-center` when compact: React Flow centres that with
  // `translateX(-50%)`, which pushes half the row off the left of a phone
  // screen no matter what `inset-x` says. Anchoring left and stretching right
  // avoids the transform entirely.
  return (
    <Panel
      position="top-left"
      className={compact ? "!top-2 !right-2 !left-2 !m-0 !w-auto" : "!m-3"}
    >
      <div
        className={`flex gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-md ${
          compact ? "flex-row items-center overflow-x-auto" : "flex-col"
        }`}
      >
        <div className={`flex gap-1 ${compact ? "shrink-0" : "pb-1"}`}>
          {compact ? (
            // A drag-marquee is unavailable on touch: React Flow skips it, and
            // forcing it on would disable panning and pinch-zoom entirely.
            // Tapping to build up a selection is the workable equivalent.
            <ToolButton
              active={multiSelect}
              onClick={() => onMultiSelectChange(!multiSelect)}
              label="Select multiple shapes"
              title="Tap shapes to add them to the selection"
            >
              <span className="px-1 text-xs whitespace-nowrap">
                {multiSelect ? "Selecting…" : "Select many"}
              </span>
            </ToolButton>
          ) : (
            <>
              <ToolButton
                active={tool === "select"}
                onClick={() => onToolChange("select")}
                label="Select"
                title="Drag on empty canvas to select shapes. Middle or right drag pans."
              >
                ⬚
              </ToolButton>
              <ToolButton
                active={tool === "pan"}
                onClick={() => onToolChange("pan")}
                label="Pan"
                title="Drag to move around. Shift-drag still selects."
              >
                ✥
              </ToolButton>
            </>
          )}
        </div>

        {compact ? (
          <span className="shrink-0 self-stretch border-l border-line" aria-hidden />
        ) : (
          <p className="border-t border-line px-1 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-fg uppercase">
            Add
          </p>
        )}
        {PALETTE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(SHAPE_DRAG_MIME, kind);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(kind)}
            title={
              kind === "start"
                ? "Terminator — adds START, or END once the chart has a start. Switch it in the sidebar."
                : `${KIND_INFO[kind].name} — click to add, or drag onto the canvas`
            }
            aria-label={kind === "start" ? "Add terminator" : `Add ${KIND_INFO[kind].name}`}
            className="relative shrink-0 cursor-grab rounded p-1 hover:bg-surface-muted active:cursor-grabbing"
          >
            <span
              className="relative block"
              style={{ width: PREVIEW_W, height: PREVIEW_H }}
            >
              <ShapeOutline
                kind={kind}
                width={PREVIEW_W}
                height={PREVIEW_H}
                strokeWidth={1.25}
                // The one button stands for both terminators, so show both.
                splitWith={kind === "start" ? "end" : undefined}
              />
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={`min-h-8 min-w-9 flex-1 rounded px-2 py-1 text-sm leading-none ${
        active ? "bg-accent text-accent-fg" : "text-muted-fg hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}
