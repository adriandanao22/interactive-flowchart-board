"use client";

import { ViewportPortal, useStore, useViewport } from "@xyflow/react";
import { useState } from "react";

import {
  AUTHOR_MAX,
  BODY_MAX,
  COMMENT_NAME_KEY,
  commentProblem,
  relativeTime,
  type Comment,
  type Region,
} from "@/lib/comments";
import type { BoardNode } from "@/lib/layout";
import { useNow } from "@/lib/useNow";
import { useStored } from "@/lib/useStored";

/** What a floating thread is attached to. */
export type Anchor =
  | { kind: "node"; nodeId: string }
  | { kind: "region"; region: Region }
  /** A region just drawn, with nothing posted to it yet. */
  | { kind: "draft"; region: Region };

interface Props {
  comments: Comment[];
  nodes: BoardNode[];
  chartKey: string | null;
  /** So a shape with nothing on it yet still offers a way to start. */
  selectedNodeId: string | null;
  /** Which thread is open, if any. */
  open: Anchor | null;
  onOpen: (anchor: Anchor | null) => void;
  onPost:
    | ((body: string, author: string, nodeId: string | null, region: Region | null) => Promise<string | null>)
    | null;
  onDelete: ((id: string) => void) | null;
  /** Set for the chart's author, whose name comes from their account. */
  authorName?: string | null;
  /**
   * Dock the thread along the bottom instead of floating it.
   *
   * A card anchored in flow space is unusable on a phone: zoomed out far
   * enough to see the chart it renders about 100px wide with 5px text, and
   * zoomed in far enough to read it, it is off the side of the screen. A sheet
   * is always full width, always legible, and always where the keyboard
   * expects it.
   */
  docked?: boolean;
}

const CARD_WIDTH = 260;
/** Gap between a shape and the card floating beside it. */
const CARD_GAP = 16;

function sameAnchor(a: Anchor | null, b: Anchor): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.nodeId === b.nodeId;
  if (a.kind !== "node" && b.kind !== "node") {
    return a.region.x === b.region.x && a.region.y === b.region.y && a.region.w === b.region.w;
  }
  return false;
}

/**
 * Comment threads drawn on the canvas rather than in the sidebar.
 *
 * Everything here goes through `ViewportPortal`, which renders inside React
 * Flow's transformed layer — so a card given flow coordinates stays welded to
 * its shape through pan and zoom without any of it being recalculated here.
 *
 * Only one thread is expanded at a time. A busy chart with every thread open
 * would bury the flowchart under its own commentary, which is the opposite of
 * the point.
 */
export function CommentLayer({
  comments,
  nodes,
  chartKey,
  selectedNodeId,
  open,
  onOpen,
  onPost,
  onDelete,
  authorName,
  docked = false,
}: Props) {
  const now = useNow();
  /**
   * Pins are positioned in flow space but held at a constant screen size.
   *
   * Without the inverse scale a pin shrinks as the canvas zooms out — which is
   * exactly when it is needed, because zooming out to find an outlined area
   * left its badge about eight pixels across and impossible to hit. Docked
   * means touch, where the target also has to suit a fingertip rather than a
   * cursor.
   */
  const { zoom } = useViewport();
  const pinScale = 1 / zoom;
  const pinSize = docked
    ? "min-h-9 min-w-9 px-2.5 text-sm"
    : "min-h-6 min-w-6 px-2 text-[11px]";

  const here = comments.filter((c) => (c.chartKey ?? null) === chartKey);
  const regions = here.filter((c) => c.region !== null);

  // One entry per distinct outlined area, so two comments on the same region
  // share a rectangle instead of stacking two identical ones.
  const regionGroups = new Map<string, { region: Region; comments: Comment[] }>();
  for (const comment of regions) {
    const key = JSON.stringify(comment.region);
    const found = regionGroups.get(key);
    if (found) found.comments.push(comment);
    else regionGroups.set(key, { region: comment.region!, comments: [comment] });
  }

  const draft = open?.kind === "draft" ? open.region : null;

  // Pins per shape. Comments on the chart as a whole belong to no shape and
  // stay in the sidebar list.
  const byNode = new Map<string, Comment[]>();
  for (const comment of here) {
    if (!comment.nodeId) continue;
    const found = byNode.get(comment.nodeId);
    if (found) found.push(comment);
    else byNode.set(comment.nodeId, [comment]);
  }

  /** The thread behind whichever anchor is open. */
  const openComments = !open
    ? []
    : open.kind === "node"
      ? here.filter((c) => c.nodeId === open.nodeId)
      : open.kind === "region"
        ? here.filter(
            (c) =>
              c.region &&
              c.region.x === open.region.x &&
              c.region.y === open.region.y &&
              c.region.w === open.region.w,
          )
        : [];

  const pinned = (
    <ViewportPortal>
      {/* ---- pins on shapes ---- */}
      {nodes.map((node) => {
        const group = byNode.get(node.id);
        const isOpen = sameAnchor(open, { kind: "node", nodeId: node.id });
        // A selected shape with nothing on it still offers a way in, faintly,
        // so starting a thread does not mean hunting through the sidebar.
        const empty = !group && selectedNodeId === node.id && Boolean(onPost);
        if (!group && !empty) return null;

        return (
          <button
            key={`pin-${node.id}`}
            type="button"
            onClick={() => onOpen(isOpen ? null : { kind: "node", nodeId: node.id })}
            // pointer-events-auto for the same reason as the card: the
            // viewport this is portalled into does not take clicks.
            className={`nodrag nopan pointer-events-auto absolute flex items-center justify-center gap-0.5 rounded-full font-bold tabular-nums shadow ${pinSize}`}
            style={{
              // Top-right of the shape; the visit badge takes the top-left.
              transform: `translate(${node.position.x + (node.width ?? 0)}px, ${node.position.y}px) scale(${pinScale}) translate(-60%, -60%)`,
              transformOrigin: "top left",
              background: isOpen ? "var(--accent)" : "var(--surface)",
              color: isOpen ? "var(--accent-fg)" : "var(--foreground)",
              border: "1.5px solid var(--accent)",
              opacity: empty ? 0.75 : 1,
            }}
            title={
              group
                ? `${group.length} comment${group.length === 1 ? "" : "s"} on this shape`
                : "Comment on this shape"
            }
          >
            <span aria-hidden>💬</span>
            {group ? group.length : "+"}
          </button>
        );
      })}

      {/* ---- outlined areas ---- */}
      {[...regionGroups.values()].map(({ region, comments: group }) => {
        const isOpen = sameAnchor(open, { kind: "region", region });
        return (
          <div
            key={`${region.x},${region.y},${region.w},${region.h}`}
            className="absolute"
            style={{
              transform: `translate(${region.x}px, ${region.y}px)`,
              width: region.w,
              height: region.h,
              border: `2px ${isOpen ? "solid" : "dashed"} var(--accent)`,
              borderRadius: 8,
              background: `color-mix(in srgb, var(--accent) ${isOpen ? 10 : 5}%, transparent)`,
              pointerEvents: "none",
            }}
          >
            <button
              type="button"
              onClick={() => onOpen(isOpen ? null : { kind: "region", region })}
              className={`nodrag nopan pointer-events-auto absolute flex items-center justify-center gap-1 rounded-full font-bold shadow ${pinSize}`}
              style={{
                // Anchored to the outline's top-left and lifted clear of it,
                // then held at a constant screen size like the shape pins.
                top: 0,
                left: 0,
                transform: `scale(${pinScale}) translate(-25%, -55%)`,
                transformOrigin: "top left",
                background: isOpen ? "var(--accent)" : "var(--surface)",
                color: isOpen ? "var(--accent-fg)" : "var(--foreground)",
                border: "1.5px solid var(--accent)",
              }}
            >
              <span aria-hidden>💬</span>
              {group.length}
            </button>
          </div>
        );
      })}

      {/* ---- an area just outlined, not yet posted to ---- */}
      {draft && (
        <div
          className="pointer-events-none absolute"
          style={{
            transform: `translate(${draft.x}px, ${draft.y}px)`,
            width: draft.w,
            height: draft.h,
            border: "2px solid var(--accent)",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          }}
        />
      )}

      {/* ---- the open thread, floating beside its anchor ---- */}
      {open && !docked && (
        <ThreadCard
          anchor={open}
          nodes={nodes}
          comments={openComments}
          now={now}
          onClose={() => onOpen(null)}
          onPost={onPost}
          onDelete={onDelete}
          authorName={authorName}
        />
      )}
    </ViewportPortal>
  );

  return (
    <>
      {pinned}
      {/* Outside the portal: a docked sheet must not move with the canvas. */}
      {open && docked && (
        <ThreadSheet
          anchor={open}
          nodes={nodes}
          comments={openComments}
          now={now}
          onClose={() => onOpen(null)}
          onPost={onPost}
          onDelete={onDelete}
          authorName={authorName}
        />
      )}
    </>
  );
}

interface ThreadProps {
  anchor: Anchor;
  nodes: BoardNode[];
  comments: Comment[];
  now: number;
  onClose: () => void;
  onPost: Props["onPost"];
  onDelete: Props["onDelete"];
  authorName?: string | null;
}

/** What the thread is attached to, for the header. */
function anchorTitle(anchor: Anchor, node: BoardNode | null | undefined): string {
  if (anchor.kind === "node") return (node?.data.label as string) ?? "Shape";
  return anchor.kind === "draft" ? "New area" : "This area";
}

function ThreadCard({
  anchor,
  nodes,
  comments,
  now,
  onClose,
  onPost,
  onDelete,
  authorName,
}: ThreadProps) {
  const remembered = useStored(COMMENT_NAME_KEY);
  const [typedAuthor, setTypedAuthor] = useState<string | null>(null);
  const isOwner = Boolean(authorName);
  const author = isOwner ? authorName! : (typedAuthor ?? remembered);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Beside the shape or area, never on top of it — the thing being discussed
  // has to stay visible while the discussion is read.
  const node = anchor.kind === "node" ? nodes.find((n) => n.id === anchor.nodeId) : null;
  const box =
    anchor.kind === "node"
      ? node
        ? { x: node.position.x, y: node.position.y, w: node.width ?? 0 }
        : null
      : { x: anchor.region.x, y: anchor.region.y, w: anchor.region.w };

  const { x: viewX, zoom } = useViewport();
  const paneWidth = useStore((state) => state.width);

  /**
   * Positioned in flow space but sized in screen pixels.
   *
   * Living inside the transformed viewport is what keeps the card welded to
   * its shape, but it also means the canvas zoom scales it: at 0.4× the text
   * came out about five pixels tall, and at 1.75× the card was wider than a
   * phone. Undoing the zoom on this one element keeps it anchored *and*
   * legible, whatever the canvas is doing.
   *
   * With the card at a fixed screen size, the gap and the width are screen
   * measurements too, so they are divided back into flow units to place it.
   */
  const at = box
    ? (() => {
        const anchorRight = (box.x + box.w) * zoom + viewX;
        const flip = paneWidth > 0 && anchorRight + CARD_GAP + CARD_WIDTH > paneWidth;
        return {
          x: flip
            ? box.x - (CARD_GAP + CARD_WIDTH) / zoom
            : box.x + box.w + CARD_GAP / zoom,
          y: box.y,
        };
      })()
    : null;

  if (!at) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!onPost || busy) return;

    const said = commentProblem(author, body);
    if (said) {
      setProblem(said);
      return;
    }

    setBusy(true);
    setProblem(null);
    const failed = await onPost(
      body,
      author,
      anchor.kind === "node" ? anchor.nodeId : null,
      anchor.kind === "node" ? null : anchor.region,
    );
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    if (!isOwner) window.localStorage.setItem(COMMENT_NAME_KEY, author.trim());
    setBody("");
  }

  return (
    <div
      // Two separate things have to be undone for this card to be usable.
      //
      // `.react-flow__viewport` is `pointer-events: none` and the portal sits
      // inside it — nodes switch it back on for themselves, and anything else
      // rendered in there has to do the same or every click falls straight
      // through to the pane behind. That is what stopped the comment box
      // taking focus. The portal also sets `user-select: none`, which would
      // leave the text unselectable and uncopyable.
      //
      // The class names are React Flow's own opt-outs, needed once the card
      // *does* receive events: nopan so a press does not drag the canvas,
      // nowheel so scrolling the thread does not zoom it, nodrag so the card
      // is not a handle for the node underneath.
      className="nodrag nopan nowheel pointer-events-auto absolute select-text"
      style={{
        // The inverse scale is what holds the card at a constant screen size;
        // the origin has to be its own corner or it drifts off the anchor.
        transform: `translate(${at.x}px, ${at.y}px) scale(${1 / zoom})`,
        transformOrigin: "top left",
        width: CARD_WIDTH,
      }}
      // Still stopped, so a click in the card does not clear the selection.
      onClick={(event) => event.stopPropagation()}
    >
      <div className="rounded-lg border border-line bg-surface p-2.5 shadow-xl">
        <ThreadBody
          title={anchorTitle(anchor, node)}
          comments={comments}
          now={now}
          onClose={onClose}
          onDelete={onDelete}
          canPost={Boolean(onPost)}
          isOwner={isOwner}
          author={author}
          onAuthorChange={setTypedAuthor}
          body={body}
          onBodyChange={setBody}
          busy={busy}
          problem={problem}
          onSubmit={submit}
          listMaxClass="max-h-56"
        />
      </div>
    </div>
  );
}

/**
 * The same thread, docked along the bottom of the canvas.
 *
 * Used on phones, where a card anchored in flow space cannot win: it is either
 * too small to read or too wide for the screen, and once the keyboard opens it
 * is usually behind it. Full width and a fixed position solve all three, at
 * the cost of no longer sitting beside the shape — so the header names what it
 * is attached to, and the pin or outline on the canvas stays highlighted.
 */
function ThreadSheet({
  anchor,
  nodes,
  comments,
  now,
  onClose,
  onPost,
  onDelete,
  authorName,
}: ThreadProps) {
  const remembered = useStored(COMMENT_NAME_KEY);
  const [typedAuthor, setTypedAuthor] = useState<string | null>(null);
  const isOwner = Boolean(authorName);
  const author = isOwner ? authorName! : (typedAuthor ?? remembered);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const node = anchor.kind === "node" ? nodes.find((n) => n.id === anchor.nodeId) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!onPost || busy) return;

    const said = commentProblem(author, body);
    if (said) {
      setProblem(said);
      return;
    }

    setBusy(true);
    setProblem(null);
    const failed = await onPost(
      body,
      author,
      anchor.kind === "node" ? anchor.nodeId : null,
      anchor.kind === "node" ? null : anchor.region,
    );
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    if (!isOwner) window.localStorage.setItem(COMMENT_NAME_KEY, author.trim());
    setBody("");
  }

  return (
    <div
      className="nodrag nopan nowheel pointer-events-auto absolute inset-x-0 bottom-0 z-30 max-h-[62%] overflow-y-auto rounded-t-xl border-t border-line bg-surface p-3 shadow-2xl select-text"
      onClick={(event) => event.stopPropagation()}
    >
      <ThreadBody
        title={anchorTitle(anchor, node)}
        comments={comments}
        now={now}
        onClose={onClose}
        onDelete={onDelete}
        canPost={Boolean(onPost)}
        isOwner={isOwner}
        author={author}
        onAuthorChange={setTypedAuthor}
        body={body}
        onBodyChange={setBody}
        busy={busy}
        problem={problem}
        onSubmit={submit}
        // The sheet scrolls as a whole, so the list does not need its own cap.
        listMaxClass=""
        roomy
      />
    </div>
  );
}

/** Header, thread and form — identical whether floating or docked. */
function ThreadBody({
  title,
  comments,
  now,
  onClose,
  onDelete,
  canPost,
  isOwner,
  author,
  onAuthorChange,
  body,
  onBodyChange,
  busy,
  problem,
  onSubmit,
  listMaxClass,
  roomy = false,
}: {
  title: string;
  comments: Comment[];
  now: number;
  onClose: () => void;
  onDelete: Props["onDelete"];
  canPost: boolean;
  isOwner: boolean;
  author: string;
  onAuthorChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  busy: boolean;
  problem: string | null;
  onSubmit: (event: React.FormEvent) => void;
  listMaxClass: string;
  /** Bigger text and taller targets, for a sheet under a thumb. */
  roomy?: boolean;
}) {
  const text = roomy ? "text-sm" : "text-xs";
  const small = roomy ? "text-xs" : "text-[11px]";

  return (
    <>
      <div className="mb-1.5 flex items-center gap-2">
        <p
          className={`min-w-0 flex-1 truncate font-semibold tracking-wider text-muted-fg uppercase ${small}`}
        >
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 rounded leading-none text-muted-fg hover:text-foreground ${
            roomy ? "min-h-9 px-3 text-lg" : "px-1 text-sm"
          }`}
          aria-label="Close thread"
        >
          ×
        </button>
      </div>

      {comments.length > 0 && (
        <ul className={`mb-2 space-y-1.5 overflow-y-auto ${listMaxClass}`}>
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-md bg-surface-muted px-2 py-1.5">
              <div className="flex items-baseline gap-1.5">
                <span className={`min-w-0 truncate font-semibold ${small}`}>{comment.author}</span>
                {comment.fromAuthor && (
                  <span
                    className="shrink-0 rounded-full px-1 text-[9px] font-bold uppercase"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                  >
                    author
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-muted-fg">
                  {relativeTime(comment.createdAt, now)}
                </span>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(comment.id)}
                    className={`ml-auto shrink-0 rounded text-danger hover:bg-surface ${
                      roomy ? "min-h-9 px-3 text-xs" : "px-1 text-[10px]"
                    }`}
                    aria-label="Delete comment"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className={`mt-0.5 leading-relaxed whitespace-pre-wrap ${text}`}>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <form className="space-y-1.5" onSubmit={onSubmit}>
          {!isOwner && (
            <input
              value={author}
              onChange={(event) => onAuthorChange(event.target.value)}
              maxLength={AUTHOR_MAX}
              placeholder="Your name"
              className={`w-full rounded-md border border-line bg-surface-muted px-2 outline-none focus:border-accent ${
                roomy ? "min-h-10 py-2 text-sm" : "py-1 text-xs"
              }`}
            />
          )}
          <textarea
            value={body}
            onChange={(event) => onBodyChange(event.target.value)}
            maxLength={BODY_MAX}
            rows={roomy ? 3 : 2}
            placeholder={isOwner ? "Reply, or leave a note…" : "Ask about this…"}
            className={`w-full resize-y rounded-md border border-line bg-surface-muted px-2 outline-none focus:border-accent ${
              roomy ? "py-2 text-sm" : "py-1 text-xs"
            }`}
          />
          {problem && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] leading-relaxed text-danger">
              {problem}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className={`w-full rounded-md bg-accent px-2 font-medium text-accent-fg disabled:opacity-50 ${
              roomy ? "min-h-11 py-2 text-sm" : "min-h-8 py-1 text-xs"
            }`}
          >
            {busy ? "Posting…" : comments.length ? "Reply" : "Comment"}
          </button>
        </form>
      ) : (
        comments.length === 0 && <p className={`text-muted-fg ${small}`}>Nothing here yet.</p>
      )}
    </>
  );
}
