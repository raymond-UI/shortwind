import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Dropdown menu (epic #184 polish). Styling is the Shortwind `@menu-trigger` /
 * `@menu` / `@menu-item` recipes; behaviour is minimal React — no component
 * library (per /ui). Outside-click and Escape close it; the panel fades in (no
 * sharp show/hide).
 *
 * `children` is a render-prop receiving a `close()` callback so items can close
 * the menu after acting.
 */
export function Menu({
  trigger,
  align = "start",
  label,
  children,
}: {
  trigger: ReactNode;
  align?: "start" | "end";
  label?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        className="@menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={
            "@menu absolute z-50 mt-1 " + (align === "end" ? "right-0" : "left-0")
          }
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** A single menu row — the `@menu-item` recipe. `active` marks the current value. */
export function MenuItem({
  onSelect,
  active = false,
  children,
  testId,
}: {
  onSelect: () => void;
  active?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      {...(active ? { "data-active": "" } : {})}
      onClick={onSelect}
      className="@menu-item w-full text-left"
    >
      {children}
    </button>
  );
}
