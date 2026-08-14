"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SAMPLE_DOC,
  lintDocument,
  routineFromName,
  type FlowchartDocument,
  type FlowchartSpec,
  type NodeKind,
} from "@/lib/flowchart";
import {
  DEFAULT_LABEL,
  edgeStyleFor,
  freePosition,
  layoutSpec,
  measureNode,
  nextNodeId,
  type BoardNode,
  type HandleId,
} from "@/lib/layout";
import { looksLikeSpec, parseDocument } from "@/lib/parse";
import { loadChart, saveChart } from "@/lib/storage";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";
import {
  INITIAL_RUN,
  calleeOf,
  type ChartKey,
  choose,
  startRun,
  step,
  supplyInput,
  takenEdgeIds,
  visitCounts,
  waitingNodeIds,
  type RunState,
} from "@/lib/runner";

import { AccountPanel, type SaveState } from "./AccountPanel";
import { ChartBar } from "./ChartBar";
import { Console } from "./Console";
import { ImportPanel } from "./ImportPanel";
import { Inspector, type Selection } from "./Inspector";
import { JsonImportDialog } from "./JsonImportDialog";
import { RoutinePanel } from "./RoutinePanel";
import { RunPanel } from "./RunPanel";
import { ShapeNode, type NodeRunState } from "./ShapeNode";
import { SHAPE_DRAG_MIME, ShapePalette } from "./ShapePalette";

const nodeTypes: NodeTypes = { flowShape: ShapeNode };

/** Quiet period after the last edit before the chart is written back. */
const AUTOSAVE_DELAY_MS = 1200;

/** Delay between auto-played steps. Slow enough to follow by eye. */
const PLAY_INTERVAL_MS = 850;

/** Laid out once at module load so the first paint already shows the sample. */
const INITIAL_BOARD = layoutSpec(SAMPLE_DOC.main);

function BoardInner() {
  const [doc, setDoc] = useState<FlowchartDocument>(SAMPLE_DOC);
  /** Chart the canvas is editing: null is the main chart, a string a routine. */
  const [editingKey, setEditingKey] = useState<ChartKey>(null);
  const spec = (editingKey === null ? doc.main : doc.routines[editingKey]) ?? doc.main;

  /** Update whichever chart is being edited, leaving the others untouched. */
  const setSpec = useCallback(
    (update: (prev: FlowchartSpec) => FlowchartSpec) =>
      setDoc((prev) =>
        editingKey === null
          ? { ...prev, main: update(prev.main) }
          : prev.routines[editingKey]
            ? {
                ...prev,
                routines: { ...prev.routines, [editingKey]: update(prev.routines[editingKey]) },
              }
            : prev,
      ),
    [editingKey],
  );
  /** Routine shown in the overlay: pinned by click, or driven by the run. */
  const [pinnedRoutine, setPinnedRoutine] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>(INITIAL_BOARD.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(INITIAL_BOARD.edges);
  const [selection, setSelection] = useState<Selection>(null);

  const [run, setRun] = useState<RunState>(INITIAL_RUN);
  const [playing, setPlaying] = useState(false);


  const [user, setUser] = useState<User | null>(null);
  /**
   * The document as last written to Supabase. Comparing by reference tells us
   * whether there is anything to save without an effect having to set a flag.
   */
  const [savedDoc, setSavedDoc] = useState<FlowchartDocument | null>(null);
  /**
   * True once we know what this user already had stored. Saving before that
   * would overwrite their chart with whatever happened to be on screen.
   */
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonSeed, setJsonSeed] = useState("");
  /** Adjustments the parser made to the last import, shown until dismissed. */
  const [repairs, setRepairs] = useState<string[]>([]);

  const { fitView, setCenter, getNode, screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  // ---- spec → board ---------------------------------------------------

  /** Replace the whole document: re-layout, reset the run, refit the viewport. */
  const applyDoc = useCallback(
    (next: FlowchartDocument) => {
      const laid = layoutSpec(next.main);
      setDoc(next);
      setEditingKey(null);
      setPinnedRoutine(null);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setSelection(null);
      setRun(INITIAL_RUN);
      setPlaying(false);
      // Wait for the new nodes to be measured before framing them.
      requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 320 });
      });
    },
    [fitView, setEdges, setNodes],
  );

  /**
   * Point the canvas at another chart. Positions are not kept per chart, so
   * the incoming one is laid out fresh — the same thing "Tidy layout" does.
   */
  const editChart = useCallback(
    (key: ChartKey) => {
      const target = (key === null ? doc.main : doc.routines[key]) ?? null;
      if (!target) return;
      const laid = layoutSpec(target);
      setEditingKey(key);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setSelection(null);
      requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 320 });
      });
    },
    [doc, fitView, setEdges, setNodes],
  );

  /** Re-run the layout over the current spec, discarding manual positions. */
  const relayout = useCallback(() => {
    const laid = layoutSpec(spec);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.16, duration: 320 });
    });
  }, [fitView, setEdges, setNodes, spec]);

  // ---- editing --------------------------------------------------------

  const renameNode = useCallback(
    (id: string, label: string) => {
      setSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
      }));
      // Resize in place rather than re-laying out, so the board does not jump
      // on every keystroke.
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const size = measureNode(n.data.kind, label);
          return { ...n, ...size, data: { ...n.data, label, ...size } };
        }),
      );
    },
    [setNodes, setSpec],
  );

  /** Point a subroutine shape at a routine, or clear the link. */
  const setNodeCalls = useCallback(
    (id: string, callee: string) => {
      setSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== id) return n;
          const next = { ...n };
          if (callee) next.calls = callee;
          else delete next.calls;
          return next;
        }),
      }));
      setRun(INITIAL_RUN);
      setPlaying(false);
    },
    [setSpec],
  );

  /** Set or clear a shape's executable code. */
  const setNodeExpr = useCallback(
    (id: string, text: string) => {
      setSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== id) return n;
          // Clearing the box removes the field entirely, so the label is
          // reconsidered as code — an empty string would mean "never code".
          const next = { ...n };
          if (text.trim()) next.expr = text;
          else delete next.expr;
          return next;
        }),
      }));
      setRun(INITIAL_RUN);
      setPlaying(false);
    },
    [setSpec],
  );

  const rekindNode = useCallback(
    (id: string, kind: NodeKind) => {
      setSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? { ...n, kind } : n)),
      }));
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const size = measureNode(kind, n.data.label);
          return { ...n, ...size, data: { ...n.data, kind, ...size } };
        }),
      );
    },
    [setNodes, setSpec],
  );

  const relabelEdge = useCallback(
    (id: string, label: string) => {
      setSpec((prev) => ({
        ...prev,
        edges: prev.edges.map((e) => (e.id === id ? { ...e, label } : e)),
      }));
      setEdges((prev) => prev.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)));
    },
    [setEdges, setSpec],
  );

  /** Keep the spec in step with deletions React Flow has already applied. */
  const dropNodes = useCallback((deleted: Node[]) => {
    const gone = new Set(deleted.map((n) => n.id));
    setSpec((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => !gone.has(n.id)),
      edges: prev.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    }));
    setSelection(null);
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, [setSpec]);

  const dropEdges = useCallback((deleted: Edge[]) => {
    const gone = new Set(deleted.map((e) => e.id));
    setSpec((prev) => ({ ...prev, edges: prev.edges.filter((e) => !gone.has(e.id)) }));
    setSelection(null);
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, [setSpec]);

  /**
   * Create a shape. `at` is a flow-space top-left corner; without one the
   * shape lands in the middle of whatever the user is currently looking at.
   */
  const addNode = useCallback(
    (kind: NodeKind, at?: { x: number; y: number }) => {
      const label = DEFAULT_LABEL[kind];
      const size = measureNode(kind, label);

      let position = at;
      if (!position) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const centre = rect
          ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
          : { x: 0, y: 0 };
        position = { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
      }

      const id = nextNodeId(spec.nodes);
      setSpec((prev) => ({ ...prev, nodes: [...prev.nodes, { id, kind, label }] }));
      setNodes((prev) => [
        ...prev,
        {
          id,
          type: "flowShape",
          position: freePosition(position, prev),
          data: { kind, label, ...size },
          ...size,
          draggable: true,
        },
      ]);

      // Select it so the inspector opens ready for the label to be typed.
      setSelection({ type: "node", id });
      setRun(INITIAL_RUN);
      setPlaying(false);
    },
    [screenToFlowPosition, setNodes, setSpec, spec.nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`;
      const next = { id, source: connection.source, target: connection.target, label: "" };
      setSpec((prev) => ({ ...prev, edges: [...prev.edges, next] }));
      // Respect the sides the user actually dragged between rather than
      // re-deriving them; they placed the arrow deliberately.
      setEdges((prev) =>
        addEdge(
          edgeStyleFor(next, {
            sourceHandle: (connection.sourceHandle as HandleId | null) ?? "b",
            targetHandle: (connection.targetHandle as HandleId | null) ?? "t",
            isLoopBack: false,
          }),
          prev,
        ),
      );
      setRun(INITIAL_RUN);
      setPlaying(false);
    },
    [setEdges, setSpec],
  );

  // ---- run controls ---------------------------------------------------

  const doStep = useCallback(() => {
    setRun((prev) => (prev.status === "idle" ? startRun(doc) : step(doc, prev)));
  }, [doc]);

  const doChoose = useCallback(
    (edgeId: string) => {
      setRun((prev) => choose(doc, prev, edgeId));
    },
    [doc],
  );

  const doSupplyInput = useCallback(
    (text: string) => {
      setRun((prev) => supplyInput(doc, prev, text));
    },
    [doc],
  );

  const addRoutine = useCallback(
    (name: string) => {
      // "function(i)" means key `function` with parameter `i`, so that writing
      // function(i) on a shape actually resolves to this routine.
      const parsed = routineFromName(name);
      let key = parsed.key;
      let n = 2;
      while (doc.routines[key]) key = `${parsed.key}${n++}`;
      const blank: FlowchartSpec = {
        title: parsed.title,
        ...(parsed.params.length ? { params: parsed.params } : {}),
        nodes: [
          { id: "r1", kind: "start", label: "Start" },
          { id: "r2", kind: "end", label: "return result" },
        ],
        edges: [{ id: "re1", source: "r1", target: "r2", label: "" }],
      };
      setDoc((prev) => ({ ...prev, routines: { ...prev.routines, [key]: blank } }));
      setRun(INITIAL_RUN);
      setPlaying(false);
      // Layout inline: editChart reads `doc`, which has not updated yet.
      const laid = layoutSpec(blank);
      setEditingKey(key);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setSelection(null);
      requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 320 }));
    },
    [doc.routines, fitView, setEdges, setNodes],
  );

  const renameRoutine = useCallback((key: string, title: string) => {
    setDoc((prev) =>
      prev.routines[key]
        ? { ...prev, routines: { ...prev.routines, [key]: { ...prev.routines[key], title } } }
        : prev,
    );
  }, []);

  const setRoutineParams = useCallback((key: string, params: string[]) => {
    setDoc((prev) => {
      const routine = prev.routines[key];
      if (!routine) return prev;
      const next = { ...routine };
      if (params.length) next.params = params;
      else delete next.params;
      return { ...prev, routines: { ...prev.routines, [key]: next } };
    });
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, []);

  const deleteRoutine = useCallback(
    (key: string) => {
      setDoc((prev) => {
        const routines = { ...prev.routines };
        delete routines[key];
        return { ...prev, routines };
      });
      setRun(INITIAL_RUN);
      setPlaying(false);
      // Fall back to the main chart, which always exists.
      const laid = layoutSpec(doc.main);
      setEditingKey(null);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setSelection(null);
      requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 320 }));
    },
    [doc.main, fitView, setEdges, setNodes],
  );

  /** Wipe the console without disturbing the run. */
  const clearOutput = useCallback(() => {
    setRun((prev) => ({ ...prev, output: [] }));
  }, []);

  const resetRun = useCallback(() => {
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, []);

  // A run only auto-advances while it has an unambiguous next step; a decision
  // or a terminator needs the human back in the loop.
  const canAdvance = run.status === "idle" || run.status === "running";
  const actuallyPlaying = playing && canAdvance;

  useEffect(() => {
    if (!playing || !canAdvance) return;
    const timer = setTimeout(doStep, run.status === "idle" ? 0 : PLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
    // `run` (not just its status) so each completed step schedules the next.
  }, [playing, canAdvance, run, doStep]);

  // Keep the active node in view as the trace moves.
  useEffect(() => {
    if (!run.currentId) return;
    const node = getNode(run.currentId);
    if (!node) return;
    const w = node.measured?.width ?? node.width ?? 0;
    const h = node.measured?.height ?? node.height ?? 0;
    void setCenter(node.position.x + w / 2, node.position.y + h / 2, {
      duration: 400,
      zoom: undefined,
    });
  }, [run.currentId, getNode, setCenter]);

  const focusNode = useCallback(
    (id: string) => {
      setSelection({ type: "node", id });
      void fitView({ nodes: [{ id }], padding: 1.4, duration: 320, maxZoom: 1.3 });
    },
    [fitView],
  );

  // ---- image import ---------------------------------------------------

  const importDoc = useCallback(
    (next: FlowchartDocument, fixes: string[]) => {
      applyDoc(next);
      setRepairs(fixes);
    },
    [applyDoc],
  );

  // Paste anywhere on the page, except while typing in a field. Text that
  // looks like a chart is imported straight in.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeSpec(text)) return;
      event.preventDefault();

      const result = parseDocument(text);
      if (result.doc && result.repairs.length === 0) {
        // Clean paste — skip the dialog entirely.
        importDoc(result.doc, []);
        return;
      }
      // Anything needing a second look opens the dialog with the text in place.
      setJsonSeed(text);
      setJsonOpen(true);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importDoc]);

  // ---- account and autosave --------------------------------------------

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    let live = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (live) setUser(data.session?.user ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Pull the user's saved chart in when they sign in.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    void (async () => {
      const result = await loadChart(user.id);
      if (cancelled) return;

      if (result.error) {
        // Leave `hydrated` false: a failed read must not be followed by a
        // write, or an unreadable row gets replaced by whatever is on screen.
        setSaveError(result.error);
        return;
      }
      if (result.doc) {
        applyDoc(result.doc);
        setSavedDoc(result.doc);
      } else {
        // Nothing stored yet — the board they are looking at becomes theirs.
        setSavedDoc(null);
      }
      if (result.repairs.length) setRepairs(result.repairs);
      setSaveError(null);
      setHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, applyDoc]);

  // Write back after a pause in editing.
  useEffect(() => {
    if (!user || !hydrated || savedDoc === doc) return;

    const timer = setTimeout(async () => {
      setSaving(true);
      const error = await saveChart(user.id, doc);
      setSaving(false);
      setSaveError(error);
      if (!error) setSavedDoc(doc);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [doc, user, hydrated, savedDoc]);

  const saveState: SaveState = !supabaseConfigured || !user
    ? { kind: "off" }
    : saveError
      ? { kind: "error", message: saveError }
      : saving
        ? { kind: "saving" }
        : hydrated && savedDoc !== doc
          ? { kind: "dirty" }
          : { kind: "clean" };

  // ---- derived render data --------------------------------------------

  const warnings = useMemo(() => lintDocument(doc), [doc]);

  const displayNodes = useMemo(() => {
    const states = new Map<string, NodeRunState>();
    for (const entry of run.trace) {
      if (entry.chartKey === editingKey) states.set(entry.nodeId, "visited");
    }
    // A call site sits suspended while its routine runs; mark it, and only
    // show "current" when the trace is actually in this chart.
    for (const id of waitingNodeIds(run, editingKey)) states.set(id, "waiting");
    if (run.currentId && run.chartKey === editingKey) states.set(run.currentId, "current");
    const counts = visitCounts(run, editingKey);

    return nodes.map((node) => ({
      ...node,
      selected: selection?.type === "node" && selection.id === node.id,
      data: {
        ...node.data,
        runState: states.get(node.id) ?? "none",
        visits: counts.get(node.id) ?? 0,
      },
    }));
  }, [nodes, run, selection, editingKey]);

  const displayEdges = useMemo(() => {
    const taken = takenEdgeIds(run, editingKey);
    const offered = new Set(run.chartKey === editingKey ? run.choices.map((c) => c.id) : []);

    return edges.map((edge) => {
      const highlighted = offered.has(edge.id) || taken.has(edge.id);
      return {
        ...edge,
        selected: selection?.type === "edge" && selection.id === edge.id,
        className: offered.has(edge.id) ? "edge-choice" : taken.has(edge.id) ? "edge-taken" : "",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 18,
          height: 18,
          color: highlighted ? "var(--edge-taken)" : "var(--edge)",
        },
      };
    });
  }, [edges, run, selection, editingKey]);

  const selectedNode = useMemo(
    () => (selection?.type === "node" ? (spec.nodes.find((n) => n.id === selection.id) ?? null) : null),
    [selection, spec.nodes],
  );

  const selectedEdge = useMemo(
    () => (selection?.type === "edge" ? (spec.edges.find((e) => e.id === selection.id) ?? null) : null),
    [selection, spec.edges],
  );

  const labelOf = useCallback(
    (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id,
    [spec.nodes],
  );

  const outgoing = useMemo(
    () =>
      selectedNode
        ? spec.edges
            .filter((e) => e.source === selectedNode.id)
            .map((edge) => ({ edge, targetLabel: labelOf(edge.target) }))
        : [],
    [selectedNode, spec.edges, labelOf],
  );

  const incoming = useMemo(
    () =>
      selectedNode
        ? spec.edges
            .filter((e) => e.target === selectedNode.id)
            .map((edge) => ({ edge, sourceLabel: labelOf(edge.source) }))
        : [],
    [selectedNode, spec.edges, labelOf],
  );

  // The run drives the overlay while it is inside a routine; otherwise the
  // user can pin one open by selecting a subroutine node.
  const candidateRoutine = run.chartKey ?? pinnedRoutine;
  const shownRoutine = candidateRoutine === editingKey ? null : candidateRoutine;
  const shownRoutineSpec = shownRoutine ? (doc.routines[shownRoutine] ?? null) : null;
  const activeFrame = run.stack[run.stack.length - 1] ?? null;
  const calledFrom =
    activeFrame && activeFrame.chartKey === null
      ? (doc.main.nodes.find((n) => n.id === activeFrame.nodeId)?.label ?? null)
      : null;

  // ---- render ----------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <BoardHeader
        doc={doc}
        onRelayout={relayout}
        onPasteJson={() => {
          setJsonSeed("");
          setJsonOpen(true);
        }}
      />

      <ChartBar
        doc={doc}
        editingKey={editingKey}
        onEdit={editChart}
        onAddRoutine={addRoutine}
        onRenameRoutine={renameRoutine}
        onDeleteRoutine={deleteRoutine}
        onSetParams={setRoutineParams}
      />

      {jsonOpen && (
        <JsonImportDialog
          initialText={jsonSeed}
          onClose={() => setJsonOpen(false)}
          onImport={importDoc}
        />
      )}

      <div className="flex min-h-0 flex-1">
      <div
        ref={canvasRef}
        className="relative min-w-0 flex-1"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(SHAPE_DRAG_MIME)) event.preventDefault();
        }}
        onDrop={(event) => {
          const kind = event.dataTransfer.getData(SHAPE_DRAG_MIME) as NodeKind | "";
          if (!kind) return;
          event.preventDefault();
          // Centre the new shape on the cursor rather than hanging it off
          // the pointer's top-left corner.
          const size = measureNode(kind, DEFAULT_LABEL[kind]);
          const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          addNode(kind, { x: point.x - size.width / 2, y: point.y - size.height / 2 });
        }}
      >
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={dropNodes}
          onEdgesDelete={dropEdges}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelection({ type: "node", id: node.id });
            // Clicking a subroutine reveals the routine it calls.
            const calls = spec.nodes.find((n) => n.id === node.id)?.calls;
            setPinnedRoutine(calls && doc.routines[calls] ? calls : null);
          }}
          onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
          onPaneClick={() => setSelection(null)}
          // Every handle is declared a source; loose mode is what lets each
          // one also accept an incoming arrow.
          connectionMode={ConnectionMode.Loose}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
          maxZoom={2.5}
          fitView
          style={{ background: "var(--canvas)" }}
        >
          <ShapePalette onAdd={(kind) => addNode(kind)} />
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => `var(--${(node.data as { kind: NodeKind }).kind}-stroke)`}
            maskColor="color-mix(in srgb, var(--canvas) 72%, transparent)"
          />
        </ReactFlow>

        {(run.output.length > 0 || run.status !== "idle") && (
          <Console
            lines={run.output}
            running={run.status === "running" || run.status === "input"}
            onClear={clearOutput}
          />
        )}

        {shownRoutine && shownRoutineSpec && (
          <RoutinePanel
            chartKey={shownRoutine}
            spec={shownRoutineSpec}
            run={run}
            calledFrom={calledFrom}
            onEdit={() => {
              setPinnedRoutine(null);
              editChart(shownRoutine);
            }}
            onClose={() => setPinnedRoutine(null)}
          />
        )}

      </div>

      {/* overflow-y-auto is the safety net: on a short viewport the fixed-height
          panels can still exceed the column, and scrolling beats overlapping. */}
      <aside className="flex w-85 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
        <AccountPanel
          user={user}
          saveState={saveState}
          onSignedOut={() => {
            setUser(null);
            setSavedDoc(null);
            setHydrated(false);
            setSaveError(null);
          }}
        />

        <ImportPanel
          onLoadSample={() => applyDoc(SAMPLE_DOC)}
          onPasteJson={() => {
            setJsonSeed("");
            setJsonOpen(true);
          }}
        />

        {repairs.length > 0 && (
          <div className="shrink-0 border-t border-line bg-accent/10 px-5 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold">
                Imported with {repairs.length} adjustment{repairs.length === 1 ? "" : "s"}
              </p>
              <button
                type="button"
                onClick={() => setRepairs([])}
                className="-mt-0.5 shrink-0 rounded px-1 text-sm leading-none text-muted-fg hover:text-foreground"
                aria-label="Dismiss import notes"
              >
                ×
              </button>
            </div>
            <ul className="mt-1.5 max-h-28 list-disc space-y-1 overflow-y-auto pl-4 text-xs leading-relaxed text-muted-fg">
              {repairs.map((repair) => (
                <li key={repair}>{repair}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden border-t border-line">
          <Inspector
            selection={selection}
            node={selectedNode}
            edge={selectedEdge}
            edgeEnds={
              selectedEdge
                ? { source: labelOf(selectedEdge.source), target: labelOf(selectedEdge.target) }
                : null
            }
            outgoing={outgoing}
            incoming={incoming}
            onRenameNode={renameNode}
            onSetExpr={setNodeExpr}
            onSetCalls={setNodeCalls}
            routines={doc.routines}
            resolvedCallee={selectedNode ? calleeOf(doc, selectedNode) : null}
            onRekindNode={rekindNode}
            onDeleteNode={(id) => {
              setNodes((prev) => prev.filter((n) => n.id !== id));
              setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
              dropNodes([{ id } as Node]);
            }}
            onRelabelEdge={relabelEdge}
            onDeleteEdge={(id) => {
              setEdges((prev) => prev.filter((e) => e.id !== id));
              dropEdges([{ id } as Edge]);
            }}
          />
        </div>

        <RunPanel
          doc={doc}
          run={run}
          playing={actuallyPlaying}
          warnings={warnings}
          onStep={doStep}
          onTogglePlay={() => setPlaying((p) => !p)}
          onReset={resetRun}
          onChoose={doChoose}
          onSupplyInput={doSupplyInput}
          onFocusNode={focusNode}
        />
      </aside>
      </div>
    </div>
  );
}

function BoardHeader({
  doc,
  onRelayout,
  onPasteJson,
}: {
  doc: FlowchartDocument;
  onRelayout: () => void;
  onPasteJson: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-2.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-sm font-semibold">{doc.main.title || "Untitled flowchart"}</h1>
        <span className="hidden shrink-0 text-xs text-muted-fg sm:inline">
          {doc.main.nodes.length} shapes · {doc.main.edges.length} arrows
          {Object.keys(doc.routines).length > 0 &&
            ` · ${Object.keys(doc.routines).length} routine(s)`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRelayout}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          title="Re-run auto-layout, discarding manual positions"
        >
          Tidy layout
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              // Include routines, or copy → edit → paste would silently lose them.
              const payload = Object.keys(doc.routines).length
                ? { ...doc.main, routines: doc.routines }
                : doc.main;
              await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              // Clipboard access can be denied; nothing useful to recover here.
            }
          }}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
        <button
          type="button"
          onClick={onPasteJson}
          className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg"
        >
          Paste JSON
        </button>
      </div>
    </header>
  );
}

export function Board() {
  return (
    <ReactFlowProvider>
      <BoardInner />
    </ReactFlowProvider>
  );
}
