"use client";

import { useEffect, useRef, useState } from "react";

import type { ChartSummary } from "@/lib/storage";

interface Props {
  charts: ChartSummary[];
  currentId: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The user's charts, one row each.
 *
 * Rename is inline rather than a dialog: it is the most common of these
 * actions and the row already shows the name in the right place. Delete is the
 * only one that asks, because it is the only one that cannot be undone.
 */
export function FilePanel({
  charts,
  currentId,
  loading,
  error,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  function commit() {
    if (renaming && draft.trim()) onRename(renaming, draft.trim());
    setRenaming(null);
  }

  return (
    <div className="shrink-0 px-5 pb-2">
      {error && (
        <p className="mt-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {loading && charts.length === 0 && (
        <p className="text-xs text-muted-fg">Loading…</p>
      )}

      {!loading && charts.length === 0 && !error && (
        <p className="text-xs leading-relaxed text-muted-fg">
          Nothing saved yet. The board you are looking at becomes your first
          chart as soon as you edit it.
        </p>
      )}

      {/* Capped so a long list cannot push the inspector off the sidebar. */}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto">
        {charts.map((chart) => {
          const active = chart.id === currentId;
          return (
            <li key={chart.id}>
              {renaming === chart.id ? (
                <input
                  ref={input}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setRenaming(null);
                  }}
                  className="w-full rounded-md border border-accent bg-surface-muted px-2 py-1 text-sm outline-none"
                />
              ) : (
                <div
                  className={`group flex items-center gap-1 rounded-md px-2 py-1 ${
                    active ? "bg-accent/12 text-accent" : "hover:bg-surface-muted"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(chart.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                    title={chart.name}
                  >
                    {chart.name}
                  </button>

                  {chart.shareId && (
                    <span
                      className="shrink-0 text-[10px] text-muted-fg"
                      title="This chart has a live share link"
                      aria-label="Shared"
                    >
                      ◈
                    </span>
                  )}

                  {/* Always present on touch, where there is no hover. */}
                  <span className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(chart.name);
                        setConfirming(null);
                        setRenaming(chart.id);
                      }}
                      className="rounded px-1 py-0.5 text-[11px] hover:bg-surface"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(chart.id)}
                      className="rounded px-1 py-0.5 text-[11px] hover:bg-surface"
                      title="Duplicate"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(confirming === chart.id ? null : chart.id)}
                      className="rounded px-1 py-0.5 text-[11px] text-danger hover:bg-surface"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              )}

              {confirming === chart.id && (
                <div className="mt-1 mb-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5">
                  <p className="text-[11px] leading-relaxed text-danger">
                    Delete “{chart.name}”?
                    {chart.shareId && " Its share link stops working."} This cannot
                    be undone.
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(chart.id);
                        setConfirming(null);
                      }}
                      className="rounded-md bg-danger px-2 py-0.5 text-[11px] font-medium text-white"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium hover:bg-surface"
                    >
                      Keep
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
