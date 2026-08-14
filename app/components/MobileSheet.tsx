"use client";

import { useState, type ReactNode } from "react";

export type SheetTab = "inspect" | "run" | "chart";

interface Props {
  inspect: ReactNode;
  run: ReactNode;
  chart: ReactNode;
  /** Shown on the collapsed bar so the sheet is worth opening. */
  summary: string;
  /** Nudges the sheet open — e.g. the run needs an answer. */
  demand?: SheetTab | null;
}

const TABS: { id: SheetTab; label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "run", label: "Run" },
  { id: "chart", label: "Chart" },
];

/**
 * The sidebar, reflowed for a phone.
 *
 * On a narrow screen the desktop column would leave almost no canvas, so the
 * same panels move into a sheet along the bottom: collapsed to a single bar by
 * default, expanded to a little over half the viewport when you need it. Tabs
 * rather than the desktop's stacked layout, because scrolling past three
 * panels to reach the fourth on a phone is miserable.
 */
export function MobileSheet({ inspect, run, chart, summary, demand }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SheetTab>("inspect");

  // A pending branch choice or input prompt is useless behind a closed sheet.
  const effectiveOpen = open || demand != null;
  const effectiveTab = demand ?? tab;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex flex-col border-t border-line bg-surface md:hidden"
      style={{
        // Clear the home indicator on notched phones.
        paddingBottom: "env(safe-area-inset-bottom)",
        maxHeight: effectiveOpen ? "62dvh" : undefined,
      }}
    >
      <div className="flex shrink-0 items-stretch">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={effectiveOpen}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-4 text-left"
        >
          <span className="text-xs opacity-60">{effectiveOpen ? "▾" : "▴"}</span>
          <span className="truncate text-sm font-medium">{summary}</span>
        </button>

        {effectiveOpen && (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-pressed={effectiveTab === entry.id}
                className={`min-h-9 rounded-md px-2.5 text-xs font-medium ${
                  effectiveTab === entry.id
                    ? "bg-accent text-accent-fg"
                    : "text-muted-fg hover:bg-surface-muted"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {effectiveOpen && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
          {effectiveTab === "inspect" && inspect}
          {effectiveTab === "run" && run}
          {effectiveTab === "chart" && chart}
        </div>
      )}
    </div>
  );
}
