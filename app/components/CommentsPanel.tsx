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
  /** Only the ones the canvas cannot show — see `unanchoredComments`. */
  comments: Comment[];
  /** How many are on the canvas instead, so an empty list can say so. */
  pinnedElsewhere: number;
  loading: boolean;
  error: string | null;
  /** Label lookup for showing what a comment is pinned to. */
  labelFor: (chartKey: string | null, nodeId: string) => string | null;
  /** Null when this viewer cannot post at all. */
  onPost: ((body: string, author: string, nodeId: string | null) => Promise<string | null>) | null;
  /**
   * Set when the viewer is the chart's author. Their name comes from their
   * account rather than a text box, and the copy changes: on their own board
   * this doubles as a place to leave notes, shared or not.
   */
  authorName?: string | null;
  /** Null when this viewer cannot delete — anyone who is not the author. */
  onDelete: ((id: string) => void) | null;
  /** Author-only switch. Null hides it. */
  commentsEnabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void;
}

export function CommentsPanel({
  comments,
  pinnedElsewhere,
  loading,
  error,
  labelFor,
  onPost,
  onDelete,
  authorName,
  commentsEnabled,
  onToggleEnabled,
}: Props) {
  // Nobody wants to retype their name for every question, so it is remembered
  // — but only until they change it, which the null-means-untouched holds.
  const remembered = useStored(COMMENT_NAME_KEY);
  const [typedAuthor, setTypedAuthor] = useState<string | null>(null);
  const isOwner = Boolean(authorName);
  const author = isOwner ? authorName! : (typedAuthor ?? remembered);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bucketed to the minute, so "2m ago" ticks along without making the render
  // impure or the sidebar re-render every second.
  const now = useNow();


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
    // Always unpinned: an anchored comment is written on the canvas, beside
    // the shape or area it is about.
    const failed = await onPost(body, author, null);
    setBusy(false);
    if (failed) {
      setProblem(failed);
      return;
    }
    if (!isOwner) window.localStorage.setItem(COMMENT_NAME_KEY, author.trim());
    setBody("");
  }

  return (
    <div className="flex min-h-0 flex-col gap-2.5 px-5 pb-3">
      {onToggleEnabled && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-fg">
          <input
            type="checkbox"
            checked={commentsEnabled ?? true}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          Accept new comments
        </label>
      )}

      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {loading && comments.length === 0 && <p className="text-xs text-muted-fg">Loading…</p>}

      {!loading && comments.length === 0 && !error && (
        <p className="text-xs leading-relaxed text-muted-fg">
          {/* Comments pinned to a shape or an area live on the canvas now, so
              an empty list here does not mean an empty chart. Say which is
              which rather than implying nobody has said anything. */}
          {pinnedElsewhere > 0
            ? `${pinnedElsewhere} comment${pinnedElsewhere === 1 ? "" : "s"} on this chart, all attached to a shape or an area — click one to read it.`
            : isOwner
              ? "Nothing yet. Click a shape to leave yourself a note on it, and anything people say through your share link turns up here too."
              : onPost
                ? "Nothing yet. Click a shape to ask about it, or write below to ask about the chart as a whole."
                : "No comments yet."}
        </p>
      )}

      <div className="max-h-72 min-h-0 space-y-3 overflow-y-auto">
        {comments.length > 0 && (
          <Thread
            comments={comments}
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
            About the chart as a whole. To ask about one shape or one area,
            click it on the canvas and write there instead.
          </p>
          {!isOwner && (
            <input
              value={author}
              onChange={(event) => setTypedAuthor(event.target.value)}
              maxLength={AUTHOR_MAX}
              placeholder="Your name"
              className="w-full rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          )}
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={BODY_MAX}
            rows={3}
            placeholder={isOwner ? "Reply, or leave yourself a note…" : "Ask a question or leave a note…"}
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
            {busy ? "Posting…" : isOwner ? "Post as author" : "Post comment"}
          </button>
          <p className="text-[11px] leading-relaxed text-muted-fg">
            {isOwner
              ? "Posted as you, and marked as the author. Anyone holding a share link to this chart can read it."
              : "Everyone with this link can read what you write, and the chart’s author can delete it."}
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
                {comment.fromAuthor && (
                  <span
                    className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold tracking-wide uppercase"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                    title="Written by the person who made this chart"
                  >
                    author
                  </span>
                )}
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
