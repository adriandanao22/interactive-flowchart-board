"use client";

import { Panel } from "@xyflow/react";

import { KIND_INFO, NODE_KINDS, type NodeKind } from "@/lib/flowchart";

import { ShapeOutline } from "./ShapeOutline";

/** Drag payload type, so a shape drag is distinguishable from a file drop. */
export const SHAPE_DRAG_MIME = "application/x-flowchart-kind";

interface Props {
  onAdd: (kind: NodeKind) => void;
}

const PREVIEW_W = 34;
const PREVIEW_H = 22;

/**
 * Floating palette of the seven shapes. Click to drop one into the middle of
 * the view, or drag one onto the canvas to place it exactly.
 */
export function ShapePalette({ onAdd }: Props) {
  return (
    <Panel position="top-left" className="!m-3">
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-md">
        <p className="px-1 pt-0.5 pb-1 text-[10px] font-semibold tracking-wider text-muted-fg uppercase">
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
