import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

import { isBranching, type FlowEdgeSpec, type FlowchartSpec, type NodeKind } from "./flowchart";

export interface FlowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  width: number;
  height: number;
}

export type BoardNode = Node<FlowNodeData>;

/**
 * Every edge we emit is a smoothstep edge, whose corner radius is set through
 * `pathOptions` — a field the generic `Edge` type does not carry.
 */
export type BoardEdge = Edge<Record<string, unknown>, "smoothstep"> & {
  pathOptions?: { borderRadius?: number; offset?: number };
};

/** Base footprint per shape, before the label is measured. */
const BASE_SIZE: Record<NodeKind, { width: number; height: number }> = {
  start: { width: 150, height: 52 },
  end: { width: 150, height: 52 },
  process: { width: 200, height: 62 },
  decision: { width: 210, height: 118 },
  io: { width: 210, height: 64 },
  subroutine: { width: 210, height: 66 },
  connector: { width: 56, height: 56 },
};

/**
 * A diamond only offers its full width at the vertical midpoint, so a label
 * that fits a rectangle of the same size will overflow the points. Give
 * decisions a narrower text column and let them grow taller instead.
 */
const TEXT_INSET: Record<NodeKind, number> = {
  start: 28,
  end: 28,
  process: 28,
  decision: 96,
  io: 48,
  subroutine: 44,
  connector: 12,
};

const CHAR_WIDTH = 7.1; // ~13px system sans, measured empirically
const LINE_HEIGHT = 18;

/**
 * Grow a node vertically until its label fits. Sizing here rather than from
 * the DOM keeps layout deterministic: dagre needs real dimensions before
 * React has rendered anything.
 */
export function measureNode(kind: NodeKind, label: string) {
  const base = BASE_SIZE[kind];
  // A fresh object every time. Returning the shared constant made every
  // connector hand dagre the same object, so dagre's x/y writes landed on top
  // of each other and both halves of a pair stacked at one point — and the
  // constant itself came back polluted with layout fields.
  if (kind === "connector") return { ...base };

  const textWidth = base.width - TEXT_INSET[kind];
  const perLine = Math.max(6, Math.floor(textWidth / CHAR_WIDTH));

  // Wrap on whole words so the line count matches what the browser will do.
  let lines = 1;
  let used = 0;
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const cost = used === 0 ? word.length : word.length + 1;
    if (used + cost > perLine && used > 0) {
      lines += 1;
      used = word.length;
    } else {
      used += cost;
    }
    // A single word longer than the line wraps mid-word.
    while (used > perLine) {
      lines += 1;
      used -= perLine;
    }
  }

  const textBlock = lines * LINE_HEIGHT;
  const padding = kind === "decision" ? 56 : 26;
  return { width: base.width, height: Math.max(base.height, textBlock + padding) };
}

export type HandleId = "t" | "r" | "b" | "l";

export interface EdgeRouting {
  sourceHandle: HandleId;
  targetHandle: HandleId;
  isLoopBack: boolean;
}

/** A laid-out node's centre and size, as dagre reports it. */
interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How far a child must sit off-centre before a decision branches out of its
 * side point instead of its bottom point.
 */
const SIDE_EXIT_THRESHOLD = 24;

/**
 * Pick which sides an arrow should leave and enter.
 *
 * Three cases, matching how flowcharts are drawn by hand:
 *  - an ordinary step runs bottom to top, straight down the page;
 *  - a decision branch leaves the diamond's left or right point when its
 *    child sits off to that side, which is what makes Yes/No read as a fork
 *    rather than as two more sequential steps;
 *  - a back-edge leaves and re-enters on the same side, so the loop arm runs
 *    down the outside of the chart instead of cutting back through it.
 */
export function routeEdge(
  source: Placed,
  target: Placed,
  { sourceBranches }: { sourceBranches: boolean },
): EdgeRouting {
  const isLoopBack = target.y <= source.y;
  const dx = target.x - source.x;

  if (isLoopBack) {
    // Ties go right, so a plain vertical loop always picks a consistent side.
    const side: HandleId = dx < -1 ? "l" : "r";
    return { sourceHandle: side, targetHandle: side, isLoopBack: true };
  }

  if (sourceBranches && Math.abs(dx) > SIDE_EXIT_THRESHOLD) {
    return { sourceHandle: dx > 0 ? "r" : "l", targetHandle: "t", isLoopBack: false };
  }

  return { sourceHandle: "b", targetHandle: "t", isLoopBack: false };
}

/**
 * Stop a decision's branches from leaving through the same point.
 *
 * `routeEdge` looks at one arrow at a time, so two children that both sit to
 * the right both ask for the right point and their arrows overlap coming out
 * of the diamond. When that happens the branch reaching furthest to the side
 * keeps it and the nearer one — which is close to straight below anyway —
 * drops out of the bottom instead.
 */
function spreadSiblingBranches(
  edges: readonly FlowEdgeSpec[],
  routings: Map<string, EdgeRouting>,
  placed: Map<string, Placed>,
  fallback: Placed,
): void {
  const bySource = new Map<string, FlowEdgeSpec[]>();
  for (const edge of edges) {
    // Loop arms deliberately hug a side; only forward branches compete.
    if (routings.get(edge.id)?.isLoopBack) continue;
    const group = bySource.get(edge.source);
    if (group) group.push(edge);
    else bySource.set(edge.source, [edge]);
  }

  for (const [sourceId, group] of bySource) {
    if (group.length < 2) continue;
    const source = placed.get(sourceId) ?? fallback;
    const offset = (edge: FlowEdgeSpec) =>
      Math.abs((placed.get(edge.target) ?? fallback).x - source.x);

    const taken = new Set(group.map((e) => routings.get(e.id)!.sourceHandle));

    for (const side of ["l", "r"] as const) {
      const sharing = group.filter((e) => routings.get(e.id)!.sourceHandle === side);
      if (sharing.length < 2) continue;
      if (taken.has("b")) continue; // nowhere to move them to

      // Furthest out keeps the side; the rest fall back to straight down.
      const ordered = [...sharing].sort((a, b) => offset(b) - offset(a));
      for (const edge of ordered.slice(1)) {
        routings.set(edge.id, { ...routings.get(edge.id)!, sourceHandle: "b" });
      }
      taken.add("b");
    }
  }
}

export function edgeStyleFor(spec: FlowEdgeSpec, routing: EdgeRouting): BoardEdge {
  return {
    id: spec.id,
    source: spec.source,
    target: spec.target,
    sourceHandle: routing.sourceHandle,
    targetHandle: routing.targetHandle,
    label: spec.label || undefined,
    type: "smoothstep",
    // A wider radius on the loop arm reads as "this goes back" rather than
    // "this is another square corner in the flow".
    pathOptions: { borderRadius: routing.isLoopBack ? 24 : 8 },
    data: { isLoopBack: routing.isLoopBack },
  };
}

/** Placeholder text for a freshly added shape — a hint, not a real label. */
export const DEFAULT_LABEL: Record<NodeKind, string> = {
  start: "Start",
  end: "End",
  process: "Do something",
  decision: "Condition?",
  io: "Input / output",
  subroutine: "routine()",
  connector: "A",
};

/** Next free `nN` id, so added shapes keep the same naming as imported ones. */
export function nextNodeId(existing: readonly { id: string }[]): string {
  let highest = 0;
  for (const node of existing) {
    const match = /^n(\d+)$/.exec(node.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let candidate = highest + 1;
  const taken = new Set(existing.map((n) => n.id));
  while (taken.has(`n${candidate}`)) candidate += 1;
  return `n${candidate}`;
}

/**
 * Nudge a drop point until it is not sitting on top of an existing node, so
 * repeatedly clicking the same palette button cascades instead of stacking.
 */
export function freePosition(
  wanted: { x: number; y: number },
  taken: readonly { position: { x: number; y: number } }[],
): { x: number; y: number } {
  const position = { ...wanted };
  for (let attempt = 0; attempt < 40; attempt++) {
    const clash = taken.some(
      (node) =>
        Math.abs(node.position.x - position.x) < 24 && Math.abs(node.position.y - position.y) < 24,
    );
    if (!clash) break;
    position.x += 28;
    position.y += 28;
  }
  return position;
}

/**
 * Run the spec through dagre and emit React Flow nodes/edges with absolute
 * positions. Dagre positions by node centre; React Flow positions by top-left.
 */
export function layoutSpec(spec: FlowchartSpec): {
  nodes: BoardNode[];
  edges: BoardEdge[];
} {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 56, ranksep: 64, marginx: 32, marginy: 32 });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of spec.nodes) {
    const size = measureNode(node.kind, node.label);
    sizes.set(node.id, size);
    // Dagre mutates the value it is given, so hand it a copy rather than the
    // object we keep.
    graph.setNode(node.id, { ...size });
  }

  const known = new Set(spec.nodes.map((n) => n.id));
  const validEdges = spec.edges.filter((e) => known.has(e.source) && known.has(e.target));
  for (const edge of validEdges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const placed = new Map<string, Placed>();
  const nodes: BoardNode[] = spec.nodes.map((node) => {
    const size = sizes.get(node.id)!;
    const positioned = graph.node(node.id);
    // Dagre drops nodes it could not place (fully disconnected); fall back to
    // the origin rather than emitting NaN positions that break the renderer.
    const x = positioned?.x ?? 0;
    const y = positioned?.y ?? 0;
    placed.set(node.id, { x, y, ...size });

    return {
      id: node.id,
      type: "flowShape",
      position: { x: x - size.width / 2, y: y - size.height / 2 },
      data: { kind: node.kind, label: node.label, width: size.width, height: size.height },
      // Sizing is ours, not the DOM's — keep React Flow from re-measuring.
      width: size.width,
      height: size.height,
      draggable: true,
    };
  });

  // A source only branches out its sides if it is a decision with a real fork
  // to represent, so a single-exit decision still flows straight down.
  const outDegree = new Map<string, number>();
  for (const edge of validEdges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  }
  const kinds = new Map(spec.nodes.map((node) => [node.id, node.kind]));

  const fallback: Placed = { x: 0, y: 0, width: 0, height: 0 };
  const routings = new Map<string, EdgeRouting>();
  for (const edge of validEdges) {
    const source = placed.get(edge.source) ?? fallback;
    const target = placed.get(edge.target) ?? fallback;
    const sourceBranches =
      isBranching(kinds.get(edge.source) ?? "process") && (outDegree.get(edge.source) ?? 0) > 1;
    routings.set(edge.id, routeEdge(source, target, { sourceBranches }));
  }

  spreadSiblingBranches(validEdges, routings, placed, fallback);

  const edges: BoardEdge[] = validEdges.map((edge) => edgeStyleFor(edge, routings.get(edge.id)!));

  return { nodes, edges };
}
