"use client";

import { useEffect, useState } from "react";

import type { FlowchartDocument } from "@/lib/flowchart";
import { parseDocument } from "@/lib/parse";

/** Where an import should land. */
export type ImportTarget = "new" | "replace";

interface Props {
  /** Pre-fills the box — used when a paste arrives that needs review. */
  initialText?: string;
  /**
   * False when there is nowhere else for a chart to go — signed out, or
   * looking at someone else's board — in which case the only option is to
   * replace what is on screen.
   */
  canAddNew: boolean;
  /** Name of the chart that "Replace" would overwrite. */
  currentName: string;
  onClose: () => void;
  onImport: (doc: FlowchartDocument, repairs: string[], target: ImportTarget) => void;
}

/**
 * Mounted only while open, so each appearance starts from a clean slate
 * without an effect reaching in to reset it.
 */
export function JsonImportDialog({
  initialText = "",
  canAddNew,
  currentName,
  onClose,
  onImport,
}: Props) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(target: ImportTarget) {
    const result = parseDocument(text);
    if (!result.doc) {
      setError(result.error ?? "Could not read that JSON.");
      return;
    }
    onImport(result.doc, result.repairs, target);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself dismisses; a drag that started
        // inside the textarea and ended out here should not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="json-import-title"
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-2xl"
      >
        <div>
          <h2 id="json-import-title" className="text-sm font-semibold">
            Import flowchart JSON
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-fg">
            Paste the JSON a model produced from your flowchart image. Code fences and
            surrounding chatter are stripped automatically. An optional{" "}
            <code className="font-mono">routines</code> object adds bodies for subroutine
            shapes to step into.
          </p>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              submit(canAddNew ? "new" : "replace");
            }
          }}
          spellCheck={false}
          placeholder={'{ "title": "…", "nodes": [ … ], "edges": [ … ] }'}
          className="h-72 w-full resize-none rounded-md border border-line bg-surface-muted p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent"
        />

        {error && (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-muted-fg">
            <kbd className="font-mono">Ctrl</kbd>+<kbd className="font-mono">Enter</kbd> to{" "}
            {canAddNew ? "add as a new chart" : "import"}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => submit("replace")}
              disabled={!text.trim()}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
              title={
                canAddNew
                  ? `Overwrite “${currentName}” with this chart`
                  : "Put this chart on the board"
              }
            >
              {canAddNew ? "Replace this chart" : "Import"}
            </button>
            {canAddNew && (
              <button
                type="button"
                onClick={() => submit("new")}
                disabled={!text.trim()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
              >
                Add as new chart
              </button>
            )}
          </div>
        </div>

        {canAddNew && (
          <p className="text-[11px] leading-relaxed text-muted-fg">
            <b>Add as new</b> keeps everything you already have. <b>Replace</b>{" "}
            overwrites “{currentName}” — its current contents are gone once the
            next autosave lands.
          </p>
        )}
      </div>
    </div>
  );
}
