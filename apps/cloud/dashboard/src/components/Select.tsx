import { useEffect, useRef, useState } from "react";

/**
 * A custom select — a field-styled trigger (matches `@input`) that opens a
 * `@menu` panel of options, instead of a native `<select>`. Outside-click and
 * Escape close it; the current value carries a check. Built bespoke (not on the
 * Menu component) so the trigger reads as a form field, not a button.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  label?: string;
  testId?: string;
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
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className="@input flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{value}</span>
        <span
          className={
            "text-muted-foreground transition-transform" + (open ? " rotate-180" : "")
          }
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {open && (
        <div role="listbox" className="@menu absolute z-50 mt-1 max-h-56 w-full overflow-y-auto">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              role="option"
              aria-selected={o === value}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              className="@menu-item w-full text-left"
              {...(o === value ? { "data-active": "" } : {})}
            >
              <span className="w-3.5 shrink-0 text-term" aria-hidden="true">
                {o === value ? "›" : ""}
              </span>
              <span className="truncate">{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
