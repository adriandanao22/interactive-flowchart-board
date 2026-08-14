"use client";

interface Props {
  onLoadSample: () => void;
  onPasteJson: () => void;
}

/**
 * How a chart gets onto the board. Transcription happens outside the app —
 * paste the image into a chat model with the prompt in PASTE.md, then bring
 * the JSON here — so there is nothing to configure and no key to hold.
 */
export function ImportPanel({ onLoadSample, onPasteJson }: Props) {
  return (
    <div className="flex shrink-0 flex-col gap-3 p-5">
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
          Load a chart
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-fg">
          Paste flowchart JSON anywhere on the page (<kbd className="font-mono">Ctrl</kbd>+
          <kbd className="font-mono">V</kbd>), or use the button below. To turn a picture into
          JSON, run it through a chat model with the prompt in{" "}
          <code className="font-mono">PASTE.md</code>.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPasteJson}
          className="flex-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
        >
          Paste JSON…
        </button>
        <button
          type="button"
          onClick={onLoadSample}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
        >
          Load sample
        </button>
      </div>
    </div>
  );
}
