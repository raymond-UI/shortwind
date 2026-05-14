# apps/web — `/playground`

## Scope

Live shorthand-to-rendered HTML playground. Type shorthand on the left, see expanded HTML in the middle, see rendered output on the right.

## Behavior

- Three-pane editor (CodeMirror or Monaco — pick the lighter one):
  - Pane 1: shorthand HTML input.
  - Pane 2: expanded HTML output (read-only, syntax-highlighted, with diff highlighting against input).
  - Pane 3: rendered iframe.
- Uses `@shortwind/core` compiled for the browser — same engine as the CDN expander, same engine as the bundler plugins. (Defensibility: the playground proves byte-identical output.)
- "Token count" indicator: input characters/4, output characters/4, percent savings. Same heuristic as the original demo HTML.
- Share via URL hash: shorthand input is base64-encoded into `?share=<hash>`. No server, no DB.
- "Copy as HTML" button: copies the expanded HTML to clipboard.
- "Open in CodeSandbox" / "Open in StackBlitz" buttons (later — generates a starter project with `npx shortwind init` already run).

## Tests

- Smoke: type `<div class="@card">`, expanded pane shows expansion, rendered pane shows a card.
- Share link round-trip: encode input, decode, get same content.

## Out of scope

- Editing recipes themselves (catalog is read-only too; playground only uses the default registry).
- Server-side share storage.
