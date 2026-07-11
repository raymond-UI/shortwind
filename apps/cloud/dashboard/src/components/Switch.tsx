/**
 * A custom toggle switch — the `@switch` / `@switch-thumb` recipes driven by
 * `data-checked`. A real `role="switch"` button (not a native checkbox), so it
 * matches the console's look and is keyboard/AT accessible.
 */
export function Switch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  testId?: string;
}) {
  const on = checked ? { "data-checked": "" } : {};
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="@switch"
      {...on}
    >
      <span className="@switch-thumb" {...on} />
    </button>
  );
}
