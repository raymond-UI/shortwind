import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Accessible modal dialog (epic #184 polish). Styling is the Shortwind
 * `@dialog-overlay` / `@dialog-content` recipes; behaviour is a small bit of
 * React — no component library (per /ui). Honours /ui's "no sharp show/hide":
 * fades + scales in/out via a CSS transition rather than popping.
 *
 * - Portals to `document.body` (client only — SSR-safe via the mounted guard).
 * - Escape and overlay-click close. Focus moves to the panel on open.
 * - `role="dialog"` + `aria-modal`; pass `labelledBy` pointing at your title id.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mount on open; on close keep mounted for the exit transition, then unmount.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(t);
    }
    return;
  }, [open, mounted]);

  // Escape to close + move focus into the panel while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={
        "fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 " +
        (visible ? "opacity-100" : "opacity-0")
      }
    >
      <div className="@dialog-overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={
          // Space on the non-recipe side (expander trims recipe literals).
          "@dialog-content transition-transform duration-200 outline-none" +
          (visible ? " scale-100" : " scale-95")
        }
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
