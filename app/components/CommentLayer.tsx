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
}: Props) {
  const now = useNow();
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

  return (
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
            className="absolute flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums shadow"
            style={{
              // Top-right of the shape; the visit badge takes the top-left.
              transform: `translate(${node.position.x + (node.width ?? 0) - 10}px, ${node.position.y - 10}px)`,
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
              className="pointer-events-auto absolute flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold shadow"
              style={{
                top: -12,
                left: 8,
                background: "var(--surface)",
                color: "var(--foreground)",
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

      {/* ---- the open thread ---- */}
      {open && (
        <ThreadCard
          anchor={open}
          nodes={nodes}
          comments={
            open.kind === "node"
              ? here.filter((c) => c.nodeId === open.nodeId)
              : open.kind === "region"
                ? here.filter(
                    (c) =>
                      c.region &&
                      c.region.x === open.region.x &&
                      c.region.y === open.region.y &&
                      c.region.w === open.region.w,
                  )
                : []
          }
          now={now}
          onClose={() => onOpen(null)}
          onPost={onPost}
          onDelete={onDelete}
          authorName={authorName}
        />
      )}
    </ViewportPortal>
  );
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
}: {
  anchor: Anchor;
  nodes: BoardNode[];
  comments: Comment[];
  now: number;
  onClose: () => void;
  onPost: Props["onPost"];
  onDelete: Props["onDelete"];
  authorName?: string | null;
}) {
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

  // Anchored to the right by default, but a shape near the right-hand edge
  // would put its card off the pane entirely, so flip to the other side.
  // These are the pane's own dimensions and transform, so the decision is made
  // against what is actually on screen rather than against the chart's extent.
  const { x: viewX, zoom } = useViewport();
  const paneWidth = useStore((state) => state.width);
  const at = box
    ? (() => {
        const rightEdge = (box.x + box.w + CARD_GAP + CARD_WIDTH) * zoom + viewX;
        const flip = paneWidth > 0 && rightEdge > paneWidth;
        return {
          x: flip ? box.x - CARD_GAP - CARD_WIDTH : box.x + box.w + CARD_GAP,
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
      className="absolute"
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, width: CARD_WIDTH }}
      // The canvas would otherwise take these as clicks on empty space and
      // clear the selection out from under the form.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="rounded-lg border border-line bg-surface p-2.5 shadow-xl">
        <div className="mb-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            {anchor.kind === "node"
              ? (node?.data.label ?? "Shape")
              : anchor.kind === "draft"
                ? "New area"
                : "This area"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-1 text-sm leading-none text-muted-fg hover:text-foreground"
            aria-label="Close thread"
          >
            ×
          </button>
        </div>

        {comments.length > 0 && (
          <ul className="mb-2 max-h-56 space-y-1.5 overflow-y-auto">
            {comments.map((comment) => (
              <li key={comment.id} className="rounded-md bg-surface-muted px-2 py-1.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="min-w-0 truncate text-[11px] font-semibold">
                    {comment.author}
                  </span>
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
                      className="ml-auto shrink-0 rounded px-1 text-[10px] text-danger hover:bg-surface"
                      aria-label="Delete comment"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed whitespace-pre-wrap">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        {onPost ? (
          <form className="space-y-1.5" onSubmit={submit}>
            {!isOwner && (
              <input
                value={author}
                onChange={(event) => setTypedAuthor(event.target.value)}
                maxLength={AUTHOR_MAX}
                placeholder="Your name"
                className="w-full rounded-md border border-line bg-surface-muted px-2 py-1 text-xs outline-none focus:border-accent"
              />
            )}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BODY_MAX}
              rows={2}
              placeholder={isOwner ? "Reply, or leave a note…" : "Ask about this…"}
              className="w-full resize-y rounded-md border border-line bg-surface-muted px-2 py-1 text-xs outline-none focus:border-accent"
            />
            {problem && (
              <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] leading-relaxed text-danger">
                {problem}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="min-h-8 w-full rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg disabled:opacity-50"
            >
              {busy ? "Posting…" : comments.length ? "Reply" : "Comment"}
            </button>
          </form>
        ) : (
          comments.length === 0 && (
            <p className="text-[11px] text-muted-fg">Nothing here yet.</p>
          )
        )}
      </div>
    </div>
  );
}
