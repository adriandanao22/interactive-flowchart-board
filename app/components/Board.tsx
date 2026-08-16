"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  Panel,
  SelectionMode,
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  newChartDoc,
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
  kindToAdd,
  layoutSpec,
  measureNode,
  nextNodeId,
  relabelForKind,
  type BoardNode,
  type HandleId,
} from "@/lib/layout";
import { looksLikeSpec, parseDocument } from "@/lib/parse";
import { useIsMobile } from "@/lib/useMediaQuery";
import {
  commentsByNode,
  deleteComment,
  listOwnComments,
  listSharedComments,
  pinKey,
  postComment,
  postOwnComment,
  setCommentsEnabled,
  type Comment,
} from "@/lib/comments";
import { decodeSnapshot, isShareToken, snapshotFromHash } from "@/lib/share";
import {
  type ChartSummary,
  createChart,
  deleteChart,
  listCharts,
  loadChart,
  loadSharedChart,
  nameFor,
  renameChart,
  saveChart,
  uniqueName,
} from "@/lib/storage";
import { displayName, getSupabase, supabaseConfigured } from "@/lib/supabase";
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
import { FilePanel } from "./FilePanel";
import { CommentsPanel } from "./CommentsPanel";
import { GuidePanel } from "./GuidePanel";
import { ImportPanel } from "./ImportPanel";
import { SharePanel } from "./SharePanel";
import { Inspector, type Selection } from "./Inspector";
import { MobileSheet, type SheetTab } from "./MobileSheet";
import { JsonImportDialog } from "./JsonImportDialog";
import { RoutinePanel } from "./RoutinePanel";
import { RunPanel } from "./RunPanel";
import { ShapeNode, type NodeRunState } from "./ShapeNode";
import { SHAPE_DRAG_MIME, ShapePalette } from "./ShapePalette";

const nodeTypes: NodeTypes = { flowShape: ShapeNode };

/** Quiet period after the last edit before the chart is written back. */
const AUTOSAVE_DELAY_MS = 1200;

/**
 * Which chart to reopen on the next visit. Keyed by user so two accounts on
 * one machine do not fight over the slot.
 */
const lastChartKey = (userId: string) => `board:lastChart:${userId}`;

/** Delay between auto-played steps. Slow enough to follow by eye. */
const PLAY_INTERVAL_MS = 850;

/** Laid out once at module load so the first paint already shows the sample. */
const INITIAL_BOARD = layoutSpec(SAMPLE_DOC.main);

/**
 * How this board got its chart, when it did not come from the viewer's own
 * account. Either way the chart is a throwaway copy: it can be run and edited
 * freely, and none of it is written back to anyone's row.
 */
type Visiting =
  | { kind: "live"; token: string; title: string }
  | { kind: "snapshot"; title: string };

function BoardInner({ shareToken }: { shareToken?: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<FlowchartDocument>(SAMPLE_DOC);
  /** Non-null while looking at somebody else's chart. */
  const [visiting, setVisiting] = useState<Visiting | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
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
  /**
   * Which tool the left mouse button drives. React Flow only honours
   * `selectionOnDrag` when `panOnDrag` is not plain `true`, so the two are
   * always set together.
   */
  const [tool, setTool] = useState<"select" | "pan">("select");
  /**
   * Touch multi-select. React Flow has already collapsed the selection to the
   * tapped node by the time `onNodeClick` runs, so the intended set has to be
   * tracked here rather than read back off the nodes.
   */
  const [multiSelect, setMultiSelect] = useState(false);
  const tapSelection = useRef<Set<string>>(new Set());

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
  /** The open chart's share token, once known. Null means not shared. */
  const [shareId, setShareId] = useState<string | null>(null);

  /** Every chart this user owns — names only, not their contents. */
  const [charts, setCharts] = useState<ChartSummary[]>([]);
  /** Row id of the chart on the board, or null before one is open. */
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState("");
  /**
   * Set once the list has come back. Derived rather than a `loading` flag that
   * an effect has to switch on synchronously, which would cascade a render
   * before the fetch had even started.
   */
  const [chartsLoaded, setChartsLoaded] = useState(false);
  const [chartsError, setChartsError] = useState<string | null>(null);

  /** The thread on whichever chart is on screen — shared or your own. */
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsOn, setCommentsOn] = useState(true);

  const [guideOpen, setGuideOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonSeed, setJsonSeed] = useState("");
  /** Adjustments the parser made to the last import, shown until dismissed. */
  const [repairs, setRepairs] = useState<string[]>([]);

  const { fitView, setCenter, getNode, screenToFlowPosition, deleteElements } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  // Touch has no middle or right button, so a marquee tool would strand the
  // user with no way to pan. Phones get panning; selection is by tapping.
  const effectiveTool = isMobile ? "pan" : tool;

  /** Turn tap-to-add on or off, seeding from whatever is already selected. */
  const changeMultiSelect = useCallback(
    (value: boolean) => {
      setMultiSelect(value);
      if (value) tapSelection.current = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
      else tapSelection.current.clear();
    },
    [nodes],
  );

  /** Add or remove one shape from the tap-built selection. */
  const toggleTapSelection = useCallback(
    (id: string) => {
      const next = new Set(tapSelection.current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      tapSelection.current = next;
      setNodes((prev) => prev.map((n) => ({ ...n, selected: next.has(n.id) })));
    },
    [setNodes],
  );

  // ---- spec → board ---------------------------------------------------

  /**
   * Frame a freshly laid-out chart.
   *
   * Fitting the whole thing is right on a desktop, but a tall chart squeezed
   * into a phone leaves every shape too small to read. There, open at the
   * start terminator at a legible zoom and let the reader scroll on.
   */
  const frameChart = useCallback(
    (laid: BoardNode[]) => {
      requestAnimationFrame(() => {
        const entry = laid.find((n) => n.data.kind === "start") ?? laid[0];
        if (!isMobile || !entry) {
          void fitView({ padding: 0.16, duration: 320 });
          return;
        }
        void setCenter(
          entry.position.x + (entry.width ?? 0) / 2,
          entry.position.y + (entry.height ?? 0) / 2,
          { zoom: 0.75, duration: 320 },
        );
      });
    },
    [fitView, setCenter, isMobile],
  );

  /** Replace the whole document: re-layout, reset the run, refit the viewport. */
  const applyDoc = useCallback(
    (next: FlowchartDocument) => {
      const laid = layoutSpec(next.main);
      setDoc(next);
      setEditingKey(null);
      setPinnedRoutine(null);
      setNodes(laid.nodes);
      setEdges(laid.edges);
      setRun(INITIAL_RUN);
      setPlaying(false);
      frameChart(laid.nodes);
    },
    [frameChart, setEdges, setNodes],
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
      tapSelection.current.clear();
      frameChart(laid.nodes);
    },
    [doc, frameChart, setEdges, setNodes],
  );

  /** Re-run the layout over the current spec, discarding manual positions. */
  const relayout = useCallback(() => {
    const laid = layoutSpec(spec);
    setNodes(laid.nodes);
    setEdges(laid.edges);
    frameChart(laid.nodes);
  }, [frameChart, setEdges, setNodes, spec]);

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

  /**
   * Change a shape's kind, carrying its label across.
   *
   * Flipping a terminator between START and END rewrites the label too, but
   * only when it is still the untouched default — otherwise switching would
   * leave a shape reading "START" sitting at the end of the chart. A label
   * somebody actually wrote ("Return letter") is never overwritten.
   */
  const rekindNode = useCallback(
    (id: string, kind: NodeKind) => {
      const relabel = (label: string, from: NodeKind) => relabelForKind(label, from, kind);

      setSpec((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === id ? { ...n, kind, label: relabel(n.label, n.kind) } : n,
        ),
      }));
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const label = relabel(n.data.label, n.data.kind);
          const size = measureNode(kind, label);
          return { ...n, ...size, data: { ...n.data, kind, label, ...size } };
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
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, [setSpec]);

  const dropEdges = useCallback((deleted: Edge[]) => {
    const gone = new Set(deleted.map((e) => e.id));
    setSpec((prev) => ({ ...prev, edges: prev.edges.filter((e) => !gone.has(e.id)) }));
    setRun(INITIAL_RUN);
    setPlaying(false);
  }, [setSpec]);

  /**
   * Create a shape. `at` is a flow-space top-left corner; without one the
   * shape lands in the middle of whatever the user is currently looking at.
   */
  const addNode = useCallback(
    (wanted: NodeKind, at?: { x: number; y: number }) => {
      // One palette button covers both terminators; this picks the direction.
      const kind = kindToAdd(wanted, spec.nodes);
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

      // Select only the new shape, so the inspector opens on it.
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));
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
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));
      void fitView({ nodes: [{ id }], padding: 1.4, duration: 320, maxZoom: 1.3 });
    },
    [fitView, setNodes],
  );

  // ---- image import ---------------------------------------------------

  /**
   * Whether an import has anywhere to go other than over the top of what is on
   * screen. False when signed out or visiting someone else's board — there is
   * no file list to add to in either case.
   */
  const canAddNew = Boolean(user && !visiting && supabaseConfigured);

  const importDoc = useCallback(
    (next: FlowchartDocument, fixes: string[]) => {
      applyDoc(next);
      setRepairs(fixes);
    },
    [applyDoc],
  );

  // Paste anywhere on the page, except while typing in a field.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;

      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeSpec(text)) return;
      event.preventDefault();

      const result = parseDocument(text);
      // With a file list, even a clean paste has to ask where it should land —
      // it is the one action that can destroy a chart, and the autosave makes
      // that permanent before there is time to notice.
      if (result.doc && result.repairs.length === 0 && !canAddNew) {
        importDoc(result.doc, []);
        return;
      }
      setJsonSeed(text);
      setJsonOpen(true);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importDoc, canAddNew]);

  // The `fitView` prop frames desktop-style on mount; once the media query
  // resolves, a phone needs the readable framing instead.
  useEffect(() => {
    if (!isMobile) return;
    frameChart(nodes);
    // Only when the breakpoint changes — re-framing on every node edit would
    // yank the canvas out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // ---- share links ------------------------------------------------------

  /**
   * Resolve a share link before anything else touches the board.
   *
   * Both kinds are handled here so the "am I looking at my own chart?"
   * question has one answer by the time the account effects run — otherwise a
   * signed-in user opening a share link would race their own chart against the
   * shared one, and could autosave the wrong winner over the top.
   */
  const [shareChecked, setShareChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (shareToken) {
        if (!isShareToken(shareToken)) {
          if (!cancelled) {
            setShareError("That does not look like a share link.");
            setShareChecked(true);
          }
          return;
        }
        const result = await loadSharedChart(shareToken);
        if (cancelled) return;
        if (result.doc) {
          applyDoc(result.doc);
          setVisiting({
            kind: "live",
            token: shareToken,
            title: result.doc.main.title || "Untitled flowchart",
          });
          if (result.repairs.length) setRepairs(result.repairs);
        } else {
          setShareError(result.error);
        }
        setShareChecked(true);
        return;
      }

      const payload = snapshotFromHash(window.location.hash);
      if (!payload) {
        if (!cancelled) setShareChecked(true);
        return;
      }

      const json = await decodeSnapshot(payload);
      if (cancelled) return;
      const parsed = json ? parseDocument(json) : null;
      if (parsed?.doc) {
        applyDoc(parsed.doc);
        setVisiting({ kind: "snapshot", title: parsed.doc.main.title || "Untitled flowchart" });
        if (parsed.repairs.length) setRepairs(parsed.repairs);
      } else {
        setShareError("That snapshot link could not be read — it may have been truncated.");
      }
      setShareChecked(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [shareToken, applyDoc]);

  /**
   * Stop visiting and go back to the viewer's own board.
   *
   * The two link kinds need different handling. A live link is a real route,
   * so it navigates. A snapshot lives in the fragment of the page we are
   * already on, so there is nowhere to navigate to — the payload is stripped
   * from the URL instead, which also stops a refresh from re-opening it.
   */
  const leaveShare = useCallback(() => {
    setVisiting(null);
    setShareError(null);

    if (shareToken) {
      router.replace("/");
      return;
    }

    window.history.replaceState(null, "", window.location.pathname);
    // Signed in, the account effect now pulls their chart in. Signed out there
    // is nothing to pull, so fall back to the sample rather than leaving
    // somebody else's chart sitting there looking like the user's own.
    if (!user) applyDoc(SAMPLE_DOC);
  }, [shareToken, router, user, applyDoc]);

  // ---- comments ---------------------------------------------------------

  /**
   * Load the thread for whatever is on screen.
   *
   * Two routes in, deliberately: a visitor goes through the share token, which
   * is the only thing authorising them; the author reads their own rows
   * through Row Level Security. Neither can see anything the other should not.
   */
  useEffect(() => {
    const token = visiting?.kind === "live" ? visiting.token : null;
    const owned = visiting ? null : currentId;

    let cancelled = false;
    void (async () => {
      // The "nothing to load" case goes through the same path rather than
      // returning early, so the thread is always cleared when the chart
      // changes and no state is set synchronously in the effect body.
      const result = token
        ? await listSharedComments(token)
        : owned
          ? await listOwnComments(owned)
          : { comments: [], error: null };
      if (cancelled) return;
      setCommentsLoaded(true);
      setCommentsError(result.error);
      setComments(result.comments);
    })();

    return () => {
      cancelled = true;
    };
  }, [visiting, currentId]);

  /**
   * Post to the thread, by whichever route the poster is entitled to.
   *
   * A visitor goes through the share token. The author writes directly, which
   * also means they can leave notes on a chart that has never been shared.
   * Either way the thread is re-read afterwards rather than appended to
   * locally: the database stamps and orders the row, and anyone else's
   * comments arrive in the same trip.
   */
  const addComment = useCallback(
    async (body: string, author: string, nodeId: string | null) => {
      if (visiting?.kind === "live") {
        const failed = await postComment(visiting.token, author, body, nodeId, editingKey);
        if (failed) return failed;
        const result = await listSharedComments(visiting.token);
        setComments(result.comments);
        setCommentsError(result.error);
        return null;
      }

      if (!visiting && user && currentId) {
        const failed = await postOwnComment(currentId, user.id, author, body, nodeId, editingKey);
        if (failed) return failed;
        const result = await listOwnComments(currentId);
        setComments(result.comments);
        setCommentsError(result.error);
        return null;
      }

      return "This chart is not open for comments.";
    },
    [visiting, editingKey, user, currentId],
  );

  const removeComment = useCallback(async (id: string) => {
    const failed = await deleteComment(id);
    if (failed) {
      setCommentsError(failed);
      return;
    }
    setComments((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** Label a comment's pinned shape, or null once that shape is gone. */
  const labelForPin = useCallback(
    (key: string | null, nodeId: string) => {
      const chart = key === null ? doc.main : doc.routines[key];
      return chart?.nodes.find((n) => n.id === nodeId)?.label ?? null;
    },
    [doc],
  );

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

  /**
   * Open a chart, first flushing anything the autosave timer has not written.
   *
   * `hydrated` goes false for the duration. Without that, the autosave effect
   * would see the outgoing document still on screen next to the incoming id
   * and write one over the other.
   */
  const openChart = useCallback(
    async (id: string) => {
      if (id === currentId) return;

      if (currentId && hydrated && savedDoc !== doc) await saveChart(currentId, doc);
      setHydrated(false);

      const result = await loadChart(id);
      if (result.error || !result.doc) {
        setSaveError(result.error);
        // Whatever went wrong, the row is not usable — drop it from the list
        // rather than leaving a row that cannot be opened.
        if (result.error?.includes("no longer exists")) {
          setCharts((prev) => prev.filter((c) => c.id !== id));
        }
        return;
      }

      applyDoc(result.doc);
      setSavedDoc(result.doc);
      setCurrentId(id);
      setCurrentName(result.name ?? nameFor(result.doc));
      setShareId(result.shareId ?? null);
      if (result.repairs.length) setRepairs(result.repairs);
      setSaveError(null);
      setHydrated(true);
    },
    [currentId, hydrated, savedDoc, doc, applyDoc],
  );

  // Keep a ref so effects can open a chart without taking the callback as a
  // dependency and re-running every time the document changes.
  const openChartRef = useRef(openChart);
  useEffect(() => {
    openChartRef.current = openChart;
  }, [openChart]);

  // Pull the user's charts in when they sign in. Not while visiting a share
  // link — that would replace the chart they followed the link to see.
  useEffect(() => {
    if (!user || !shareChecked || visiting) return;

    let cancelled = false;

    void (async () => {
      const { charts: list, error } = await listCharts(user.id);
      if (cancelled) return;

      setChartsLoaded(true);
      if (error) {
        // Leave `hydrated` false: a failed read must not be followed by a
        // write, or an unreadable row gets replaced by whatever is on screen.
        setChartsError(error);
        return;
      }
      setChartsError(null);
      setCharts(list);

      if (list.length === 0) {
        // Nothing stored yet — the board they are looking at becomes their
        // first chart, so a new account does not start on an empty canvas.
        const created = await createChart(user.id, nameFor(doc), doc);
        if (cancelled) return;
        if (created.error || !created.id) {
          setSaveError(created.error);
          return;
        }
        setCharts([
          { id: created.id, name: nameFor(doc), shareId: null, updatedAt: "" },
        ]);
        setCurrentId(created.id);
        setCurrentName(nameFor(doc));
        setSavedDoc(doc);
        setShareId(null);
        setHydrated(true);
        return;
      }

      // Reopen whatever they were last looking at; failing that, the most
      // recently updated, which is what the list is already sorted by.
      const remembered = window.localStorage.getItem(lastChartKey(user.id));
      const wanted = list.find((c) => c.id === remembered) ?? list[0];
      await openChartRef.current(wanted.id);
    })();

    return () => {
      cancelled = true;
    };
    // `doc` is read only to seed a first chart, and re-running on every edit
    // would re-list constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, shareChecked, visiting]);

  // Remember the open chart per user, so a reload comes back to it.
  useEffect(() => {
    if (!user || !currentId || visiting) return;
    window.localStorage.setItem(lastChartKey(user.id), currentId);
  }, [user, currentId, visiting]);

  // Write back after a pause in editing. A visited chart is a throwaway copy,
  // so edits to it must never reach the viewer's own row.
  useEffect(() => {
    if (!user || !currentId || !hydrated || visiting || savedDoc === doc) return;

    const timer = setTimeout(async () => {
      setSaving(true);
      const error = await saveChart(currentId, doc);

      // A paste can change the chart's title, and the file list shows the
      // name. Keep them in step rather than letting the list go stale.
      const title = nameFor(doc);
      if (!error && title !== currentName) {
        const failed = await renameChart(currentId, title);
        if (!failed) {
          setCurrentName(title);
          setCharts((prev) =>
            prev.map((c) => (c.id === currentId ? { ...c, name: title } : c)),
          );
        }
      }

      setSaving(false);
      setSaveError(error);
      if (!error) setSavedDoc(doc);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [doc, user, currentId, hydrated, savedDoc, visiting, currentName]);

  // ---- file actions -----------------------------------------------------

  const createNewChart = useCallback(
    async (seed?: FlowchartDocument, wantedName?: string) => {
      if (!user) return;
      if (currentId && hydrated && savedDoc !== doc) await saveChart(currentId, doc);

      const next = seed ?? newChartDoc();
      const name = uniqueName(wantedName ?? nameFor(next), charts.map((c) => c.name));
      const created = await createChart(user.id, name, next);
      if (created.error || !created.id) {
        setSaveError(created.error);
        return;
      }

      setCharts((prev) => [
        { id: created.id!, name, shareId: null, updatedAt: "" },
        ...prev,
      ]);
      setHydrated(false);
      applyDoc(next);
      setSavedDoc(next);
      setCurrentId(created.id);
      setCurrentName(name);
      setShareId(null);
      setSaveError(null);
      setHydrated(true);
    },
    [user, currentId, hydrated, savedDoc, doc, charts, applyDoc],
  );

  const duplicateChart = useCallback(
    async (id: string) => {
      if (!user) return;

      // Copying the open chart uses what is on screen, unsaved edits and all
      // — copying what is in the database would silently drop them.
      if (id === currentId) {
        await createNewChart(doc, `${currentName || nameFor(doc)} copy`);
        return;
      }

      const loaded = await loadChart(id);
      if (!loaded.doc) {
        setSaveError(loaded.error ?? "That chart could not be copied.");
        return;
      }
      await createNewChart(loaded.doc, `${loaded.name ?? nameFor(loaded.doc)} copy`);
    },
    [user, currentId, doc, currentName, createNewChart],
  );

  const removeChart = useCallback(
    async (id: string) => {
      if (!user) return;
      const error = await deleteChart(id);
      if (error) {
        setSaveError(error);
        return;
      }

      const left = charts.filter((c) => c.id !== id);
      setCharts(left);
      if (id !== currentId) return;

      // The open chart just went away. Move to another, or start fresh so the
      // board is never left showing something that no longer exists.
      setCurrentId(null);
      setHydrated(false);
      if (left.length) await openChartRef.current(left[0].id);
      else await createNewChart(newChartDoc());
    },
    [user, charts, currentId, createNewChart],
  );

  const renameCurrent = useCallback(
    async (id: string, name: string) => {
      const error = await renameChart(id, name);
      if (error) {
        setSaveError(error);
        return;
      }
      setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
      if (id !== currentId) return;

      setCurrentName(name);
      // The name and the chart's own title are the same thing to a user, so a
      // rename moves both — otherwise the header keeps the old one.
      setDoc((prev) => ({ ...prev, main: { ...prev.main, title: name } }));
    },
    [currentId],
  );

  // A visited chart is nobody's to save, so the account panel says so rather
  // than sitting on "All changes saved" while nothing is being written.
  const saveState: SaveState = !supabaseConfigured || !user || visiting
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
    const pins = commentsByNode(comments);

    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        runState: states.get(node.id) ?? "none",
        visits: counts.get(node.id) ?? 0,
        comments: pins.get(pinKey(editingKey, node.id))?.length ?? 0,
      },
    }));
  }, [nodes, run, editingKey, comments]);

  const displayEdges = useMemo(() => {
    const taken = takenEdgeIds(run, editingKey);
    const offered = new Set(run.chartKey === editingKey ? run.choices.map((c) => c.id) : []);

    return edges.map((edge) => {
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
  }, [edges, run, editingKey]);

  // React Flow owns `selected` on each node and edge; everything else reads
  // it rather than keeping a second copy that would fight the marquee.
  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selectedEdgeIds = useMemo(() => edges.filter((e) => e.selected).map((e) => e.id), [edges]);
  const selectedCount = selectedNodeIds.length + selectedEdgeIds.length;

  /** The inspector only makes sense for a single thing. */
  const selection: Selection = useMemo(
    () =>
      selectedNodeIds.length === 1 && selectedEdgeIds.length === 0
        ? { type: "node", id: selectedNodeIds[0] }
        : selectedEdgeIds.length === 1 && selectedNodeIds.length === 0
          ? { type: "edge", id: selectedEdgeIds[0] }
          : null,
    [selectedNodeIds, selectedEdgeIds],
  );

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

  /**
   * A pending decision or input is useless behind a closed sheet, so those
   * two states force it open on the tab that can answer them.
   */
  const sheetDemand: SheetTab | null =
    run.status === "awaiting" || run.status === "input" ? "run" : null;

  const sheetSummary =
    run.status === "awaiting"
      ? "Which branch?"
      : run.status === "input"
        ? `Value for ${run.awaitingInput}`
        : selectedCount > 1
          ? `${selectedCount} selected`
          : selectedNode
            ? selectedNode.label
            : selectedEdge
              ? "Arrow"
              : run.status === "running"
                ? "Running"
                : "Inspect, run, and load charts";

  // Both layouts render the same panels; only the arrangement differs.
  const accountPanel = (
    <>
      <AccountPanel
        user={user}
        saveState={saveState}
        onSignedOut={() => {
          setUser(null);
          setSavedDoc(null);
          setHydrated(false);
          setSaveError(null);
          // Everything below is the signed-out user's; none of it belongs to
          // whoever signs in next.
          setCharts([]);
          setCurrentId(null);
          setCurrentName("");
          setShareId(null);
          setChartsError(null);
          setChartsLoaded(false);
          applyDoc(SAMPLE_DOC);
        }}
      />
      {/* No file list while visiting: those charts are not loaded, and the
          banner already offers the way back to them. */}
      {user && !visiting && (
        <FilePanel
          charts={charts}
          currentId={currentId}
          loading={!chartsLoaded}
          error={chartsError}
          onOpen={(id) => void openChart(id)}
          onCreate={() => void createNewChart()}
          onRename={(id, name) => void renameCurrent(id, name)}
          onDuplicate={(id) => void duplicateChart(id)}
          onDelete={(id) => void removeChart(id)}
        />
      )}
    </>
  );
  const importPanel = (
    <ImportPanel
      onLoadSample={() => applyDoc(SAMPLE_DOC)}
      onPasteJson={() => {
        setJsonSeed("");
        setJsonOpen(true);
      }}
    />
  );
  const repairsNotice =
    repairs.length > 0 ? (
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
    ) : null;
  /**
   * Shown to a visitor of a live share link (who can post) and to the chart's
   * owner (who can read and delete). A snapshot link has no row behind it, so
   * there is nothing to comment on.
   */
  const commentsPanel =
    visiting?.kind === "live" || (currentId && !visiting) ? (
      <div className="shrink-0 border-t border-line">
        <CommentsPanel
          comments={comments}
          loading={!commentsLoaded}
          error={commentsError}
          selectedNodeId={selectedNode?.id ?? null}
          selectedNodeLabel={selectedNode?.label ?? null}
          chartKey={editingKey}
          labelFor={labelForPin}
          onPost={visiting?.kind === "live" || (!visiting && user) ? addComment : null}
          authorName={!visiting && user ? displayName(user) : null}
          onDelete={visiting ? null : (id) => void removeComment(id)}
          commentsEnabled={visiting ? undefined : commentsOn}
          onToggleEnabled={
            visiting || !currentId
              ? undefined
              : (enabled) => {
                  setCommentsOn(enabled);
                  void setCommentsEnabled(currentId, enabled).then(
                    (failed) => failed && setCommentsError(failed),
                  );
                }
          }
        />
      </div>
    ) : null;

  const inspectorPanel = (
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
        onDeleteNode={(id) => void deleteElements({ nodes: [{ id }] })}
        onRelabelEdge={relabelEdge}
        onDeleteEdge={(id) => void deleteElements({ edges: [{ id }] })}
      />
    </div>
  );
  const runPanelNode = (
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
  );

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
        chartId={currentId}
        onOpenGuide={() => setGuideOpen(true)}
        shareId={shareId}
        onShareIdChange={setShareId}
        saveDirty={saveState.kind === "dirty" || saveState.kind === "saving"}
        visiting={visiting !== null}
      />

      {visiting && <VisitingBanner visiting={visiting} onLeave={leaveShare} />}

      {shareError && (
        <div className="shrink-0 border-b border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger md:px-5">
          {shareError}{" "}
          <Link href="/" className="font-medium underline">
            Open your own board
          </Link>
        </div>
      )}

      <ChartBar
        doc={doc}
        editingKey={editingKey}
        onEdit={editChart}
        onAddRoutine={addRoutine}
        onRenameRoutine={renameRoutine}
        onDeleteRoutine={deleteRoutine}
        onSetParams={setRoutineParams}
      />

      {guideOpen && (
        <GuidePanel
          canAddNew={canAddNew}
          onLoadExample={(example) => {
            // Never at the cost of what they already have: signed in, an
            // example arrives as its own chart.
            if (canAddNew) void createNewChart(example);
            else importDoc(example, []);
          }}
          onClose={() => setGuideOpen(false)}
        />
      )}

      {jsonOpen && (
        <JsonImportDialog
          initialText={jsonSeed}
          canAddNew={canAddNew}
          currentName={currentName || doc.main.title || "this chart"}
          onClose={() => setJsonOpen(false)}
          onImport={(next, fixes, target) => {
            setRepairs(fixes);
            if (target === "new") void createNewChart(next);
            else importDoc(next, fixes);
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
      <div
        ref={canvasRef}
        className="relative min-w-0 flex-1 pb-11 md:pb-0"
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
            if (multiSelect) toggleTapSelection(node.id);
            // Otherwise selection is React Flow's job; this only reveals the
            // routine a subroutine shape calls.
            const calls = spec.nodes.find((n) => n.id === node.id)?.calls;
            setPinnedRoutine(calls && doc.routines[calls] ? calls : null);
          }}
          onPaneClick={() => {
            setPinnedRoutine(null);
            tapSelection.current.clear();
          }}
          // Every handle is declared a source; loose mode is what lets each
          // one also accept an incoming arrow.
          connectionMode={ConnectionMode.Loose}
          // Left drag draws a selection box in select mode; middle and right
          // drag always pan, so there is a way round the canvas either way.
          selectionOnDrag={effectiveTool === "select"}
          panOnDrag={effectiveTool === "select" ? [1, 2] : true}
          // Touching a shape is enough to catch it — requiring full
          // containment is fiddly when the shapes are this wide.
          selectionMode={SelectionMode.Partial}
          // Backspace alone is the library default, which left the Delete key
          // doing nothing despite the docs promising otherwise.
          deleteKeyCode={["Delete", "Backspace"]}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
          maxZoom={2.5}
          fitView
          style={{ background: "var(--canvas)" }}
        >
          <ShapePalette
            onAdd={(kind) => addNode(kind)}
            tool={tool}
            onToolChange={setTool}
            multiSelect={multiSelect}
            onMultiSelectChange={changeMultiSelect}
            compact={isMobile}
          />

          {/* mt-16 clears the compact palette, which owns the top band on a phone. */}
          {selectedCount > 1 && (
            <Panel position="top-center" className="!mx-3 !mb-3 !mt-16 md:!mt-3">
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 shadow-md">
                <span className="text-xs font-medium">
                  {selectedNodeIds.length > 0 &&
                    `${selectedNodeIds.length} shape${selectedNodeIds.length === 1 ? "" : "s"}`}
                  {selectedNodeIds.length > 0 && selectedEdgeIds.length > 0 && ", "}
                  {selectedEdgeIds.length > 0 &&
                    `${selectedEdgeIds.length} arrow${selectedEdgeIds.length === 1 ? "" : "s"}`}
                  {" selected"}
                </span>
                <span className="hidden text-[11px] text-muted-fg sm:inline">
                  drag to move together
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void deleteElements({
                      nodes: selectedNodeIds.map((id) => ({ id })),
                      edges: selectedEdgeIds.map((id) => ({ id })),
                    });
                    tapSelection.current.clear();
                  }}
                  className="min-h-8 rounded-md border border-line px-2 py-0.5 text-xs font-medium text-danger hover:bg-surface-muted"
                >
                  Delete
                </button>
              </div>
            </Panel>
          )}
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--canvas-dot)" />
          {/* Pinch and drag cover these on touch, and they crowd a small canvas. */}
          <Controls showInteractive={false} className="!hidden md:!flex" />
          <MiniMap
            className="!hidden md:!block"
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
            startCollapsed={isMobile}
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
      {/* Desktop: a column beside the canvas. */}
      <aside className="hidden w-85 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface md:flex">
        {accountPanel}
        {importPanel}
        {repairsNotice}
        {inspectorPanel}
        {commentsPanel}
        {runPanelNode}
      </aside>

      {/* Phone: the same panels in a sheet along the bottom. */}
      <MobileSheet
        summary={sheetSummary}
        demand={sheetDemand}
        inspect={inspectorPanel}
        run={runPanelNode}
        chart={
          <>
            {accountPanel}
            {importPanel}
            {repairsNotice}
            {commentsPanel}
          </>
        }
      />
      </div>
    </div>
  );
}

/**
 * Says plainly that this is somebody else's chart and that edits are going
 * nowhere — the one thing a viewer could otherwise get badly wrong, having
 * spent ten minutes rearranging a board that will not survive a refresh.
 */
function VisitingBanner({ visiting, onLeave }: { visiting: Visiting; onLeave: () => void }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface-muted px-3 py-2 text-xs md:px-5">
      <span className="font-medium">Shared chart</span>
      <span className="text-muted-fg">
        {visiting.kind === "live"
          ? "You are looking at someone else's board. Run it, edit it, break it — nothing here is saved."
          : "Unpacked from the link itself. Run it, edit it, break it — nothing here is saved."}
      </span>
      <button
        type="button"
        onClick={onLeave}
        className="ml-auto shrink-0 rounded-md border border-line bg-surface px-2.5 py-1 font-medium hover:bg-surface-muted"
      >
        Back to my board
      </button>
    </div>
  );
}

function BoardHeader({
  doc,
  onRelayout,
  onPasteJson,
  chartId,
  shareId,
  onShareIdChange,
  onOpenGuide,
  saveDirty,
  visiting,
}: {
  doc: FlowchartDocument;
  onRelayout: () => void;
  onPasteJson: () => void;
  onOpenGuide: () => void;
  chartId: string | null;
  shareId: string | null;
  onShareIdChange: (shareId: string | null) => void;
  saveDirty: boolean;
  visiting: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const payload = Object.keys(doc.routines).length
    ? { ...doc.main, routines: doc.routines }
    : doc.main;

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3 py-2 md:gap-4 md:px-5 md:py-2.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-sm font-semibold">{doc.main.title || "Untitled flowchart"}</h1>
        <span className="hidden shrink-0 text-xs text-muted-fg sm:inline">
          {doc.main.nodes.length} shapes · {doc.main.edges.length} arrows
          {Object.keys(doc.routines).length > 0 &&
            ` · ${Object.keys(doc.routines).length} routine(s)`}
        </span>
      </div>
      <div className="relative flex shrink-0 items-center gap-1.5 md:gap-2">
        <button
          type="button"
          onClick={onOpenGuide}
          className="min-h-8 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          title="How to use this board, with worked examples"
        >
          <span aria-hidden>?</span><span className="hidden sm:inline"> Guide</span>
        </button>
        <button
          type="button"
          onClick={onRelayout}
          className="min-h-8 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          title="Re-run auto-layout, discarding manual positions"
        >
          Tidy<span className="hidden sm:inline"> layout</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              // Include routines, or copy → edit → paste would silently lose them.
              await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              // Clipboard access can be denied; nothing useful to recover here.
            }
          }}
          className="min-h-8 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
        >
          {copied ? "Copied" : "Copy"}<span className="hidden sm:inline">{copied ? "" : " JSON"}</span>
        </button>
        <button
          type="button"
          onClick={() => setShareOpen((open) => !open)}
          aria-expanded={shareOpen}
          className="min-h-8 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          title={
            visiting
              ? "Pass this chart on, or take a snapshot of your edits"
              : "Get a link to this chart"
          }
        >
          Share
        </button>
        <button
          type="button"
          onClick={onPasteJson}
          className="min-h-8 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg"
        >
          Paste<span className="hidden sm:inline"> JSON</span>
        </button>

        {shareOpen && (
          <SharePanel
            // While visiting, the live half would publish somebody else's
            // chart under this user's name, so only the snapshot is offered.
            chartId={visiting ? null : chartId}
            shareId={visiting ? null : shareId}
            onShareIdChange={onShareIdChange}
            json={JSON.stringify(payload)}
            dirty={saveDirty}
            onClose={() => setShareOpen(false)}
          />
        )}
      </div>
    </header>
  );
}

export function Board({ shareToken }: { shareToken?: string } = {}) {
  return (
    <ReactFlowProvider>
      <BoardInner shareToken={shareToken} />
    </ReactFlowProvider>
  );
}
