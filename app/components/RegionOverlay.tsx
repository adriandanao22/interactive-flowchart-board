"use client";

import { useViewport } from "@xyflow/react";
import { useRef, useState } from "react";

import { rectFrom, regionIsUsable, type Region } from "@/lib/comments";

interface Props {
  /** Screen point to flow coordinates, so the region survives pan and zoom. */
  toFlow: (point: { x: number; y: number }) => { x: number; y: number };
  onDone: (region: Region) => void;
  onCancel: () => void;
}

type Drag =
  | { kind: "draw"; from: { x: number; y: number } }
  | { kind: "move"; grab: { x: number; y: number }; origin: Region }
  | { kind: "resize"; anchor: { x: number; y: number } };

/**
 * Outline an area of the canvas to comment on.
 *
 * This is a modal layer over the whole canvas rather than a React Flow
 * interaction, and that is deliberate. React Flow's own drag-select needs
 * `panOnDrag` off, which makes it reject `touchstart` outright — so on a phone
 * it would take panning and pinch-zoom with it and leave no way to reach the
 * rest of the chart. Owning the gesture here means one code path that behaves
 * identically under a mouse and a finger, and the modal framing is what makes
 * suspending panning acceptable: it is obvious, and it is one tap to leave.
 *
 * Pointer events, not mouse or touch events: they unify the two, and pointer
 * capture keeps a drag alive when the finger leaves the element.
 */
export function RegionOverlay({ toFlow, onDone, onCancel }: Props) {
  const [region, setRegion] = useState<Region | null>(null);
  const drag = useRef<Drag | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  /**
   * The pane's own transform, used to draw the outline back out.
   *
   * Deliberately not `flowToScreenPosition`: that adds the pane's bounding
   * rect to give *client* coordinates, but this overlay is positioned inside
   * the canvas container, which sits below the header and the chart bar. Using
   * client coordinates as `left`/`top` here drew the rectangle exactly that
   * offset below the cursor. Applying the transform alone gives coordinates
   * within the pane, which is the box this overlay fills.
   */
  const { x: panX, y: panY, zoom } = useViewport();
  const toLocal = (point: { x: number; y: number }) => ({
    x: point.x * zoom + panX,
    y: point.y * zoom + panY,
  });

  /** Pointer position in flow coordinates. */
  function at(event: React.PointerEvent): { x: number; y: number } {
    return toFlow({ x: event.clientX, y: event.clientY });
  }

  function begin(event: React.PointerEvent) {
    // Ignore the secondary buttons; a right-drag should not draw.
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "draw", from: at(event) };
    setRegion(null);
  }

  function move(event: React.PointerEvent) {
    const state = drag.current;
    if (!state) return;
    const point = at(event);

    if (state.kind === "draw") {
      setRegion(rectFrom(state.from, point));
    } else if (state.kind === "move") {
      setRegion({
        ...state.origin,
        x: state.origin.x + (point.x - state.grab.x),
        y: state.origin.y + (point.y - state.grab.y),
      });
    } else {
      setRegion(rectFrom(state.anchor, point));
    }
  }

  function end() {
    drag.current = null;
  }

  const box = region
    ? (() => {
        const a = toLocal({ x: region.x, y: region.y });
        const b = toLocal({ x: region.x + region.w, y: region.y + region.h });
        return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
      })()
    : null;

  const usable = region !== null && regionIsUsable(region);

  return (
    <div className="absolute inset-0 z-30">
      {/* touch-none stops the browser panning or zooming the page under the
          finger, which would otherwise cancel the drag on the first move. */}
      <div
        ref={surface}
        className="absolute inset-0 cursor-crosshair touch-none"
        style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />

      {box && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            border: "2px solid var(--accent)",
            borderRadius: 6,
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
          }}
        >
          {/* Grab handles, sized for a fingertip rather than a cursor. */}
          <span
            className="pointer-events-auto absolute touch-none"
            style={{ inset: 8, cursor: "move" }}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              if (region) drag.current = { kind: "move", grab: at(event), origin: region };
            }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
          <span
            className="pointer-events-auto absolute touch-none rounded-full"
            style={{
              right: -14,
              bottom: -14,
              width: 28,
              height: 28,
              background: "var(--accent)",
              border: "2px solid var(--canvas)",
              cursor: "nwse-resize",
            }}
            aria-label="Resize the area"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              // Resize from the opposite corner, so it stays put.
              if (region) drag.current = { kind: "resize", anchor: { x: region.x, y: region.y } };
            }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      )}

      {/* Instructions and the way out, above the drawing surface. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2.5">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 shadow-lg">
          <p className="text-xs">
            {region
              ? usable
                ? "Drag to move, or the corner to resize."
                : "That area is too small — drag out a larger one."
              : "Drag across the part of the chart you want to comment on."}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-8 shrink-0 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!usable}
            onClick={() => region && onDone(region)}
            className="min-h-8 shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-40"
          >
            Comment on this area
          </button>
        </div>
      </div>
    </div>
  );
}
