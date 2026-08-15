"use client";

import { useEffect, useRef, useState } from "react";

import { liveLink, snapshotLink, SNAPSHOT_WARN_LENGTH } from "@/lib/share";
import { startSharing, stopSharing } from "@/lib/storage";

interface Props {
  /** Null when signed out: only the snapshot link is available then. */
  userId: string | null;
  shareId: string | null;
  onShareIdChange: (shareId: string | null) => void;
  /** The chart as JSON, for building a snapshot link. */
  json: string;
  /** True while there are edits the live link has not picked up yet. */
  dirty: boolean;
  onClose: () => void;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SharePanel({
  userId,
  shareId,
  onShareIdChange,
  json,
  dirty,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"live" | "snapshot" | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Building the snapshot means compressing the whole chart, so it is done
  // once when the panel opens rather than on every keystroke behind it.
  useEffect(() => {
    let cancelled = false;
    void snapshotLink(window.location.origin, json).then((link) => {
      if (!cancelled) setSnapshot(link);
    });
    return () => {
      cancelled = true;
    };
  }, [json]);

  // Click-away and Escape, the two ways a popover is expected to close.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!panel.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // Deferred: the click that opened the panel is still propagating.
    const timer = setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const live = shareId ? liveLink(window.location.origin, shareId) : null;
  const tooLong = snapshot !== null && snapshot.length > SNAPSHOT_WARN_LENGTH;

  async function flash(kind: "live" | "snapshot", text: string) {
    if (await copy(text)) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } else {
      setError("Could not reach the clipboard — copy the link by hand.");
    }
  }

  return (
    <div
      ref={panel}
      className="absolute top-full right-0 z-40 mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-line bg-surface p-3 shadow-lg"
    >
      <p className="text-[11px] font-semibold tracking-wider text-muted-fg uppercase">Share</p>

      {/* ---- live link ---- */}
      <div className="mt-2.5">
        <p className="text-xs font-medium">Live link</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-fg">
          {userId
            ? "Always shows your latest saved version. Viewers can run and edit it; their changes never touch your copy."
            : "Sign in to publish a link that stays up to date with your edits."}
        </p>

        {userId && live && (
          <>
            <div className="mt-1.5 flex gap-1.5">
              <input
                readOnly
                value={live}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[11px] outline-none"
              />
              <button
                type="button"
                onClick={() => flash("live", live)}
                className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg"
              >
                {copied === "live" ? "Copied" : "Copy"}
              </button>
            </div>
            {dirty && (
              <p className="mt-1 text-[11px] text-muted-fg">
                Edits are still saving — viewers see them once the save lands.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const message = await stopSharing(userId);
                if (message) setError(message);
                else onShareIdChange(null);
                setBusy(false);
              }}
              className="mt-1.5 text-[11px] font-medium text-danger hover:underline disabled:opacity-50"
            >
              Stop sharing — breaks this link for everyone
            </button>
          </>
        )}

        {userId && !live && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const result = await startSharing(userId, shareId);
              if (result.error) setError(result.error);
              else onShareIdChange(result.shareId);
              setBusy(false);
            }}
            className="mt-1.5 w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create live link"}
          </button>
        )}
      </div>

      <hr className="my-3 border-line" />

      {/* ---- snapshot link ---- */}
      <div>
        <p className="text-xs font-medium">Snapshot link</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-fg">
          The whole chart is packed into the link itself — no account needed at
          either end. It is frozen as it is right now, so send a new one after
          you edit.
        </p>
        <div className="mt-1.5 flex gap-1.5">
          <input
            readOnly
            value={snapshot ?? "Building…"}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[11px] outline-none"
          />
          <button
            type="button"
            disabled={!snapshot}
            onClick={() => snapshot && flash("snapshot", snapshot)}
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"
          >
            {copied === "snapshot" ? "Copied" : "Copy"}
          </button>
        </div>
        {tooLong && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-fg">
            This one is {snapshot!.length.toLocaleString()} characters — some chat
            apps will cut it short. A live link stays short whatever the chart.
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
