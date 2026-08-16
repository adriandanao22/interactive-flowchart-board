"use client";

import { useState } from "react";

import { useStored } from "@/lib/useStored";

interface Props {
  /** Stable key for remembering open/closed across visits. */
  id: string;
  title: string;
  /** Small count or status shown beside the title while collapsed. */
  badge?: string | number | null;
  /** Action belonging to the section, kept clickable in the header. */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A collapsible band in the sidebar.
 *
 * The column has grown past what a laptop can show at once — with every panel
 * expanded the inspector was squeezed to a few hundred pixels and its lower
 * half, including the shape picker, sat below the fold inside a nested scroll
 * region nobody would think to look in. Collapsing sections gives that space
 * back to whichever one is actually being used, and the choice is remembered
 * so it does not have to be made again every visit.
 */
export function SidebarSection({ id, title, badge, action, defaultOpen = true, children }: Props) {
  const key = `board:section:${id}`;
  const stored = useStored(key);
  // Null means "not touched this session", so the remembered value wins until
  // the user says otherwise.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? (stored === "" ? defaultOpen : stored === "1");

  function toggle() {
    const next = !open;
    setOverride(next);
    window.localStorage.setItem(key, next ? "1" : "0");
  }

  return (
    <section className="shrink-0 border-b border-line">
      <div className="flex items-center gap-2 px-5 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span
            className="shrink-0 text-[10px] text-muted-fg transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
            aria-hidden
          >
            ▶
          </span>
          <span className="truncate text-[11px] font-semibold tracking-wider text-muted-fg uppercase">
            {title}
          </span>
          {badge !== null && badge !== undefined && badge !== "" && (
            <span className="shrink-0 rounded-full bg-surface-muted px-1.5 text-[10px] font-semibold text-muted-fg">
              {badge}
            </span>
          )}
        </button>
        {/* Kept out of the toggle button: a button inside a button is invalid
            and the action would swallow or be swallowed by the collapse. */}
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </section>
  );
}
