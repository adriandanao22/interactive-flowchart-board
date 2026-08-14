"use client";

import { Panel } from "@xyflow/react";

import { KIND_INFO, NODE_KINDS, type NodeKind } from "@/lib/flowchart";

import { ShapeOutline } from "./ShapeOutline";

/** Drag payload type, so a shape drag is distinguishable from a file drop. */
export const SHAPE_DRAG_MIME = "application/x-flowchart-kind";

interface Props {
  onAdd: (kind: NodeKind) => void;
  tool: "select" | "pan";
  onToolChange: (tool: "select" | "pan") => void;
}

const PREVIEW_W = 34;
const PREVIEW_H = 22;

/**
 * Floating palette of the seven shapes. Click to drop one into the middle of
 * the view, or drag one onto the canvas to place it exactly.
 */
export function ShapePalette({ onAdd, tool, onToolChange }: Props) {
  return (
    <Panel position="top-left" className="!m-3">
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-md">
        <div className="flex gap-1 pb-1">
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
        </div>

        <p className="border-t border-line px-1 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-fg uppercase">
          Add
        </p>
        {NODE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(SHAPE_DRAG_MIME, kind);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(kind)}
            title={`${KIND_INFO[kind].name} — click to add, or drag onto the canvas`}
            aria-label={`Add ${KIND_INFO[kind].name}`}
            className="relative cursor-grab rounded p-1 hover:bg-surface-muted active:cursor-grabbing"
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
      className={`flex-1 rounded px-2 py-1 text-sm leading-none ${
        active ? "bg-accent text-accent-fg" : "text-muted-fg hover:bg-surface-muted"
      }`}
    >
      {children}
    </button>
  );
}
