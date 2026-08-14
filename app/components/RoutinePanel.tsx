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
import { useMemo } from "react";

import type { FlowchartSpec } from "@/lib/flowchart";
import { layoutSpec } from "@/lib/layout";
import type { RunState } from "@/lib/runner";
import { takenEdgeIds, visitCounts } from "@/lib/runner";

import { ShapeNode, type NodeRunState } from "./ShapeNode";

const nodeTypes: NodeTypes = { flowShape: ShapeNode };

interface Props {
  /** Key of the routine being shown. */
  chartKey: string;
  spec: FlowchartSpec;
  run: RunState;
  /** Label of the call site this routine was invoked from, if it is running. */
  calledFrom: string | null;
  /** Hand this routine to the main canvas for editing. */
  onEdit: () => void;
  onClose: () => void;
}

/**
 * The callee, floated over the caller.
 *
 * Showing both at once is the whole point: the call site stays visible behind
 * this panel marked "waiting" while the trace runs in here, so the hand-off
 * and the return are something you watch rather than infer. Read-only — the
 * main canvas is where editing happens.
 */
export function RoutinePanel({ chartKey, spec, run, calledFrom, onEdit, onClose }: Props) {
  const laid = useMemo(() => layoutSpec(spec), [spec]);
  const active = run.chartKey === chartKey;

  const nodes = useMemo(() => {
    const states = new Map<string, NodeRunState>();
    if (active) {
      for (const entry of run.trace) {
        if (entry.chartKey === chartKey) states.set(entry.nodeId, "visited");
      }
      if (run.currentId) states.set(run.currentId, "current");
    }
    const counts = visitCounts(run, chartKey);

    return laid.nodes.map((node) => ({
      ...node,
      draggable: false,
      data: {
        ...node.data,
        runState: states.get(node.id) ?? "none",
        visits: counts.get(node.id) ?? 0,
      },
    }));
  }, [laid.nodes, run, chartKey, active]);

  const edges = useMemo(() => {
    const taken = takenEdgeIds(run, chartKey);
    const offered = new Set(active ? run.choices.map((c) => c.id) : []);

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
  }, [laid.edges, run, chartKey, active]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-2 pb-13 md:justify-end md:p-4">
      <div className="pointer-events-auto flex h-[50%] w-full flex-col md:h-[62%] md:w-[58%] md:min-w-80 overflow-hidden rounded-xl border-2 border-line-strong bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              <span className="text-muted-fg">routine </span>
              {spec.title || chartKey}
            </p>
            {calledFrom && (
              <p className="truncate text-[11px] text-muted-fg">
                called from “{calledFrom}” — returns there when it ends
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium hover:bg-surface-muted"
            title="Open this routine on the main canvas to edit it"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-1.5 text-sm leading-none text-muted-fg hover:text-foreground"
            aria-label="Close routine view"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {/* Its own provider: a second React Flow instance needs its own store. */}
          <ReactFlowProvider>
            <ReactFlow
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
              fitViewOptions={{ padding: 0.18 }}
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
      </div>
    </div>
  );
}
