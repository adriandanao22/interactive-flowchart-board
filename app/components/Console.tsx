"use client";

import { useEffect, useRef, useState } from "react";

import type { OutputLine } from "@/lib/runner";

interface Props {
  lines: OutputLine[];
  /** True while a run is in progress, so the console can show it is live. */
  running: boolean;
  onClear: () => void;
}

const LINE_STYLE: Record<OutputLine["kind"], string> = {
  output: "text-foreground",
  input: "text-accent",
  error: "text-danger",
};

/** Gutter marker, so the three kinds are distinguishable without colour. */
const LINE_MARK: Record<OutputLine["kind"], string> = {
  output: "›",
  input: "‹",
  error: "✕",
};

/**
 * Program output, docked along the bottom of the canvas.
 *
 * Lives here rather than in the sidebar because output is the widest thing
 * the app produces and the sidebar is already the narrowest column. Collapses
 * to a single bar so it never fights the board for space.
 */
export function Console({ lines, running, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the newest line, the way a terminal does.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines.length, collapsed]);

  const printed = lines.filter((line) => line.kind === "output").length;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
      <div className="pointer-events-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface/95 shadow-lg backdrop-blur-sm">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={!collapsed}
          >
            <span className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
              Console
            </span>
            {running && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
            )}
            <span className="truncate text-[11px] text-muted-fg">
              {printed === 0 ? "no output yet" : `${printed} line${printed === 1 ? "" : "s"}`}
            </span>
          </button>

          <button
            type="button"
            onClick={onClear}
            disabled={lines.length === 0}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-fg hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-fg hover:bg-surface-muted hover:text-foreground"
            aria-label={collapsed ? "Expand console" : "Collapse console"}
          >
            {collapsed ? "▴" : "▾"}
          </button>
        </div>

        {!collapsed && (
          <div ref={scroller} className="max-h-44 min-h-16 overflow-y-auto px-3 py-2">
            {lines.length === 0 ? (
              <p className="font-mono text-xs text-muted-fg">
                Output from <code>print</code> shapes appears here.
              </p>
            ) : (
              <ol className="space-y-0.5 font-mono text-xs leading-relaxed">
                {lines.map((line, index) => (
                  <li key={index} className={`flex gap-2 ${LINE_STYLE[line.kind]}`}>
                    <span className="shrink-0 opacity-40 select-none">{LINE_MARK[line.kind]}</span>
                    <span className="break-words whitespace-pre-wrap">{line.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
