import { useId } from "react";

import type { NodeKind } from "@/lib/flowchart";

/**
 * The SVG outline for a flowchart shape, sized to whatever box it is given.
 *
 * Shared by the canvas nodes and the palette previews so there is exactly one
 * definition of what each shape looks like. Insets are proportional rather
 * than fixed so a 30px preview reads the same as a 210px node.
 */
export function ShapeOutline({
  kind,
  width: w,
  height: h,
  strokeWidth = 1.75,
  splitWith,
}: {
  kind: NodeKind;
  width: number;
  height: number;
  strokeWidth?: number;
  /**
   * Paint the right half in a second kind's colours, divided down the middle.
   *
   * Only the palette's terminator button uses this: START and END are the same
   * drawn shape, so one button has to stand for both, and showing the two
   * colours on the one stadium says that far better than picking a side. A
   * node on the canvas is always definitively one or the other.
   */
  splitWith?: NodeKind;
}) {
  const clipId = useId();
  const i = strokeWidth / 2; // keep the stroke inside the viewBox
  const fill = `var(--${kind}-fill)`;
  const stroke = `var(--${kind}-stroke)`;
  const common = { fill, stroke, strokeWidth, strokeLinejoin: "round" as const };

  // Tuned so the full-size node matches its previous fixed values: the skew is
  // 22px at the 210px process width, and the subroutine bars sit at 13px.
  const skew = w * 0.105;
  const bar = Math.max(2, w * 0.062);
  // How far the hexagon's points cut in from each end.
  const point = w * 0.13;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
    >
      {(kind === "start" || kind === "end") && (
        <>
          <rect x={i} y={i} width={w - strokeWidth} height={h - strokeWidth} rx={(h - strokeWidth) / 2} {...common} />
          {splitWith && (
            <>
              {/* The same stadium again in the other kind's colours, showing
                  only its right half, then a rule down the join. */}
              <defs>
                <clipPath id={clipId}>
                  <rect x={w / 2} y={0} width={w / 2} height={h} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <rect
                  x={i}
                  y={i}
                  width={w - strokeWidth}
                  height={h - strokeWidth}
                  rx={(h - strokeWidth) / 2}
                  fill={`var(--${splitWith}-fill)`}
                  stroke={`var(--${splitWith}-stroke)`}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                />
              </g>
              <line
                x1={w / 2}
                y1={i}
                x2={w / 2}
                y2={h - i}
                stroke={`var(--${splitWith}-stroke)`}
                strokeWidth={strokeWidth}
              />
            </>
          )}
        </>
      )}

      {kind === "process" && (
        <rect x={i} y={i} width={w - strokeWidth} height={h - strokeWidth} rx={Math.min(7, w * 0.05)} {...common} />
      )}

      {kind === "decision" && (
        <polygon points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`} {...common} />
      )}

      {kind === "io" && (
        <polygon
          points={`${i + skew},${i} ${w - i},${i} ${w - i - skew},${h - i} ${i},${h - i}`}
          {...common}
        />
      )}

      {kind === "subroutine" && (
        <>
          <rect x={i} y={i} width={w - strokeWidth} height={h - strokeWidth} rx={Math.min(4, w * 0.05)} {...common} />
          <line x1={bar} y1={i} x2={bar} y2={h - i} stroke={stroke} strokeWidth={strokeWidth} />
          <line x1={w - bar} y1={i} x2={w - bar} y2={h - i} stroke={stroke} strokeWidth={strokeWidth} />
        </>
      )}

      {kind === "connector" && (
        <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - i} {...common} />
      )}

      {kind === "preparation" && (
        <polygon
          points={[
            `${i + point},${i}`,
            `${w - i - point},${i}`,
            `${w - i},${h / 2}`,
            `${w - i - point},${h - i}`,
            `${i + point},${h - i}`,
            `${i},${h / 2}`,
          ].join(" ")}
          {...common}
        />
      )}
    </svg>
  );
}
