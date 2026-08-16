"use client";

import { useState } from "react";

import {
  AUTHOR_MAX,
  BODY_MAX,
  COMMENT_NAME_KEY,
  commentProblem,
  relativeTime,
  type Comment,
} from "@/lib/comments";
import { useNow } from "@/lib/useNow";
import { useStored } from "@/lib/useStored";

interface Props {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  /** Shape the canvas has selected, so its thread comes to the top. */
  selectedNodeId: string | null;
  selectedNodeLabel: string | null;
  /** Which chart of the document is on the canvas. */
  chartKey: string | null;
  /** Label lookup for showing what a comment is pinned to. */
  labelFor: (chartKey: string | null, nodeId: string) => string | null;
  /** Null when this viewer cannot post — the author reading their own thread. */
  onPost: ((body: string, author: string, nodeId: string | null) => Promise<string | null>) | null;
  /** Null when this viewer cannot delete — anyone who is not the author. */
  onDelete: ((id: string) => void) | null;
  /** Author-only switch. Null hides it. */
  commentsEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
}

export function CommentsPanel({
  comments,
  loading,
  error,
  selectedNodeId,
  selectedNodeLabel,
  chartKey,
  labelFor,
  onPost,
  onDelete,
  commentsEnabled,
  onToggleEnabled,
}: Props) {
  // Nobody wants to retype their name for every question, so it is remembered
  // — but only until they change it, which the null-means-untouched holds.
  const remembered = useStored(COMMENT_NAME_KEY);
  const [typedAuthor, setTypedAuthor] = useState<string | null>(null);
  const author = typedAuthor ?? remembered;
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bucketed to the minute, so "2m ago" ticks along without making the render
  // impure or the sidebar re-render every second.
  const now = useNow();

  const pinned = selectedNodeId
    ? comments.filter((c) => c.nodeId === selectedNodeId && (c.chartKey ?? null) === chartKey)
    : [];
  const rest = comments.filter((c) => !pinned.includes(c));

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
    const failed = await onPost(body, author, selectedNodeId);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    window.localStorage.setItem(COMMENT_NAME_KEY, author.trim());
    setBody("");
  }

  return (
    <div className="flex min-h-0 flex-col gap-2.5 p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
          Comments{comments.length > 0 && ` (${comments.length})`}
        </p>
        {onToggleEnabled && (
          <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-fg">
            <input
              type="checkbox"
              checked={commentsEnabled ?? true}
              onChange={(event) => onToggleEnabled(event.target.checked)}
            />
            Accept new
          </label>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {loading && comments.length === 0 && <p className="text-xs text-muted-fg">Loading…</p>}

      {!loading && comments.length === 0 && !error && (
        <p className="text-xs leading-relaxed text-muted-fg">
          {onPost
            ? "Nothing yet. Click a shape to ask about it, or leave a note about the chart as a whole."
            : "No comments yet. They appear here as people who have your share link leave them."}
        </p>
      )}

      <div className="min-h-0 space-y-3 overflow-y-auto">
        {pinned.length > 0 && (
          <Thread
            heading={`On “${selectedNodeLabel ?? selectedNodeId}”`}
            comments={pinned}
            now={now}
            labelFor={labelFor}
            showPin={false}
            onDelete={onDelete}
          />
        )}
        {rest.length > 0 && (
          <Thread
            heading={pinned.length > 0 ? "Everything else" : undefined}
            comments={rest}
            now={now}
            labelFor={labelFor}
            showPin
            onDelete={onDelete}
          />
        )}
      </div>

      {onPost && (
        <form className="mt-1 shrink-0 space-y-1.5 border-t border-line pt-2.5" onSubmit={submit}>
          <p className="text-[11px] text-muted-fg">
            {selectedNodeId ? (
              <>
                Asking about <b>{selectedNodeLabel ?? selectedNodeId}</b>. Click
                an empty part of the canvas to ask about the chart instead.
              </>
            ) : (
              <>About the whole chart. Click a shape to pin your question to it.</>
            )}
          </p>
          <input
            value={author}
            onChange={(event) => setTypedAuthor(event.target.value)}
            maxLength={AUTHOR_MAX}
            placeholder="Your name"
            className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={BODY_MAX}
            rows={3}
            placeholder="Ask a question or leave a note…"
            className="w-full resize-y rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          {problem && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
              {problem}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {busy ? "Posting…" : "Post comment"}
          </button>
          <p className="text-[11px] leading-relaxed text-muted-fg">
            Everyone with this link can read what you write, and the chart&rsquo;s
            author can delete it.
          </p>
        </form>
      )}
    </div>
  );
}

function Thread({
  heading,
  comments,
  now,
  labelFor,
  showPin,
  onDelete,
}: {
  heading?: string;
  comments: Comment[];
  now: number;
  labelFor: (chartKey: string | null, nodeId: string) => string | null;
  showPin: boolean;
  onDelete: ((id: string) => void) | null;
}) {
  return (
    <div>
      {heading && (
        <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
          {heading}
        </p>
      )}
      <ul className="space-y-2">
        {comments.map((comment) => {
          const pin = comment.nodeId ? labelFor(comment.chartKey, comment.nodeId) : null;
          return (
            <li key={comment.id} className="rounded-md border border-line bg-surface-muted px-2.5 py-2">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-xs font-semibold">{comment.author}</span>
                <span className="shrink-0 text-[11px] text-muted-fg">
                  {relativeTime(comment.createdAt, now)}
                </span>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(comment.id)}
                    className="ml-auto shrink-0 rounded px-1 text-[11px] text-danger hover:bg-surface"
                    title="Delete this comment"
                  >
                    ✕
                  </button>
                )}
              </div>

              {showPin && comment.nodeId && (
                <p className="mt-0.5 text-[11px] text-muted-fg">
                  {pin ? (
                    <>on “{pin}”</>
                  ) : (
                    // The shape was edited away after the comment was left.
                    // Keeping the comment beats losing somebody's question.
                    <span className="italic">on a shape that has since been removed</span>
                  )}
                  {comment.chartKey && <> in {comment.chartKey}</>}
                </p>
              )}

              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap">{comment.body}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
