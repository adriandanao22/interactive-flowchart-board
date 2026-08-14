"use client";

import { useState } from "react";

import type { FlowchartDocument } from "@/lib/flowchart";
import type { ChartKey } from "@/lib/runner";

interface Props {
  doc: FlowchartDocument;
  editingKey: ChartKey;
  onEdit: (key: ChartKey) => void;
  onAddRoutine: (name: string) => void;
  onRenameRoutine: (key: string, name: string) => void;
  onDeleteRoutine: (key: string) => void;
  onSetParams: (key: string, params: string[]) => void;
}

/**
 * Picks which chart the canvas edits, and manages routines.
 *
 * There is one editable canvas rather than an editor per chart: duplicating
 * selection, the inspector and the palette into the routine overlay would mean
 * two of everything, and two places to look for the same control.
 */
export function ChartBar({
  doc,
  editingKey,
  onEdit,
  onAddRoutine,
  onRenameRoutine,
  onDeleteRoutine,
  onSetParams,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const routines = Object.keys(doc.routines);
  const active = editingKey === null ? null : doc.routines[editingKey];

  function commitNew() {
    const name = draft.trim();
    if (name) onAddRoutine(name);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-muted px-5 py-1.5">
      <span className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
        Editing
      </span>

      <div className="flex flex-wrap items-center gap-1">
        <ChartTab
          label={doc.main.title || "Main"}
          active={editingKey === null}
          onClick={() => onEdit(null)}
        />
        {routines.map((key) => (
          <ChartTab
            key={key}
            label={doc.routines[key].title || key}
            active={editingKey === key}
            onClick={() => onEdit(key)}
          />
        ))}

        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitNew}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitNew();
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="routine name"
            className="w-32 rounded-md border border-accent bg-surface px-2 py-0.5 font-mono text-xs outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            title="Add a routine"
            className="rounded-md border border-dashed border-line-strong px-2 py-0.5 text-xs font-medium text-muted-fg hover:bg-surface hover:text-foreground"
          >
            + Routine
          </button>
        )}
      </div>

      {editingKey !== null && active && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-fg">Parameters</span>
            <input
              value={(active.params ?? []).join(", ")}
              onChange={(event) =>
                onSetParams(
                  editingKey,
                  event.target.value
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean),
                )
              }
              placeholder="limit, other"
              className="w-40 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Rename routine", active.title || editingKey);
              if (name?.trim()) onRenameRoutine(editingKey, name.trim());
            }}
            className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium hover:bg-surface-muted"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => onDeleteRoutine(editingKey)}
            className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-danger hover:bg-surface-muted"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function ChartTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`max-w-48 truncate rounded-md px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-accent text-accent-fg"
          : "border border-line bg-surface hover:bg-surface-muted"
      }`}
    >
      {label}
    </button>
  );
}
