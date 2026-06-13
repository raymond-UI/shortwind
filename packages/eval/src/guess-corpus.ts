// Guessability corpus: realistic recipe names an agent/developer would type
// from an intent, paired with the recipe they mean. The guessability eval
// measures what fraction the catalog + resolver resolve correctly (target:
// ≥90%). A seed set — grow it as families and aliases land.

export type Guess = {
  // What the author was trying to style.
  intent: string;
  // The name they'd plausibly guess (without `@`).
  guess: string;
  // The real recipe they mean — resolveGuess(guess) must land here.
  expected: string;
};

// Guesses the current catalog + resolver should already handle. Most are exact
// (proof the names are the obvious word); a few exercise the grammar rewrites
// (the documented slips the @guide comments warn about).
export const GUESSES: readonly Guess[] = [
  { intent: "primary call-to-action button", guess: "btn-primary", expected: "btn-primary" },
  { intent: "destructive button", guess: "btn-danger", expected: "btn-danger" },
  { intent: "default content card", guess: "card", expected: "card" },
  { intent: "raised card", guess: "card-elevated", expected: "card-elevated" },
  { intent: "horizontal row of items", guess: "flex-row", expected: "row" }, // grammar: @row
  { intent: "row with space between", guess: "row-between", expected: "row-between" },
  { intent: "three-column grid", guess: "grid-cols-3", expected: "grid-3" }, // grammar: @grid-3
  { intent: "two-column grid", guess: "grid-2", expected: "grid-2" },
  { intent: "top-level page heading", guess: "heading-xl", expected: "heading-xl" },
  { intent: "uppercase kicker above a heading", guess: "eyebrow", expected: "eyebrow" },
  { intent: "muted secondary text", guess: "muted-text", expected: "muted" }, // grammar: drop -text
  { intent: "inline link", guess: "link", expected: "link" },
  { intent: "text input", guess: "input", expected: "input" },
  { intent: "multi-line text area", guess: "textarea", expected: "textarea" },
  { intent: "native select", guess: "select", expected: "select" },
  { intent: "checkbox", guess: "checkbox", expected: "checkbox" },
  { intent: "form field wrapper", guess: "field", expected: "field" },
  { intent: "success-tone badge", guess: "badge-success", expected: "badge-success" },
  { intent: "neutral badge", guess: "badge", expected: "badge" },
  { intent: "active tab", guess: "tab-active", expected: "tab-active" },
  { intent: "inactive nav link", guess: "nav-link", expected: "nav-link" },
  { intent: "modal dialog panel", guess: "dialog-content", expected: "dialog-content" },
  { intent: "informational alert", guess: "alert", expected: "alert" },
  { intent: "loading spinner", guess: "spinner", expected: "spinner" },
  { intent: "progress bar fill", guess: "progress-bar", expected: "progress-bar" },
  { intent: "skeleton placeholder", guess: "skeleton", expected: "skeleton" },
  { intent: "user avatar", guess: "avatar", expected: "avatar" },
  { intent: "floating tooltip", guess: "tooltip", expected: "tooltip" },
  { intent: "table header cell", guess: "th", expected: "th" },
  { intent: "centered content wrapper", guess: "wrapper", expected: "wrapper" },
  { intent: "empty-state container", guess: "empty", expected: "empty" },
  { intent: "inline code span", guess: "code-inline", expected: "code-inline" },
  // Full-word / default-size aliases (promoted from KNOWN_GAPS once the
  // abbreviation aliases + @stack default landed).
  { intent: "primary button (full word)", guess: "button-primary", expected: "button-primary" },
  { intent: "nav link (full word)", guess: "navigation-link", expected: "navigation-link" },
  { intent: "definition list (full word)", guess: "description-list", expected: "description-list" },
  { intent: "vertical stack (bare, no size)", guess: "stack", expected: "stack" },
  // New families (menu / sheet / stat / segmented / switch).
  { intent: "dropdown menu panel", guess: "menu", expected: "menu" },
  { intent: "an actions-menu row", guess: "menu-item", expected: "menu-item" },
  { intent: "slide-over panel", guess: "sheet", expected: "sheet" },
  { intent: "a drawer (slide-over)", guess: "drawer", expected: "drawer" },
  { intent: "dashboard metric tile", guess: "stat", expected: "stat" },
  { intent: "segmented control / filter bar", guess: "segmented", expected: "segmented" },
  { intent: "toggle switch", guess: "switch", expected: "switch" },
];

// Guesses that DON'T resolve yet — the real, tracked gaps. Each names what
// would close it. The test asserts these currently miss, so when a fix lands
// the assertion flips and we get a nudge to promote the entry into GUESSES.
// The abbreviation/default-size gaps are now closed (promoted above); the next
// gaps will appear when the menu/sheet/stat/segmented/switch families land.
export type KnownGap = Guess & { blockedBy: string };
export const KNOWN_GAPS: readonly KnownGap[] = [];
