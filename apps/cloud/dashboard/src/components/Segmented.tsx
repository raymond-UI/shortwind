/**
 * A segmented control — the `@segmented` / `@segmented-item` recipes. A radio
 * group of mutually-exclusive options rendered inline; the selected one is
 * marked with `data-active`. Used for small fixed choice sets (e.g. visibility).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  testId,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className="@segmented w-full"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className="@segmented-item flex-1"
          {...(value === o.value ? { "data-active": "" } : {})}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
