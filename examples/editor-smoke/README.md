# Editor smoke test — `@shortwind/cli/ts-plugin`

A 2-minute manual check that the recipe-token IntelliSense actually lights up in
a real editor (the one thing the automated tests can't cover headless).

## Run it

1. From the repo root, make sure everything's linked and built:
   ```bash
   pnpm install
   pnpm --filter @shortwind/cli build   # produces dist/ts-plugin.cjs
   ```
2. **Open this folder** (`examples/editor-smoke`) in VS Code or Cursor — open the
   folder itself, not the repo root, so the local `tsconfig` is picked up.
3. **Use the workspace TypeScript** (this is the important step — a TS plugin
   loads *only* under the workspace TS, not the editor's bundled copy):
   `Cmd/Ctrl+Shift+P` → **TypeScript: Select TypeScript Version** → **Use
   Workspace Version**.
4. Open `src/Demo.tsx` and try the five numbered spots.

If anything seems stale (or after a rebuild of the plugin): `Cmd/Ctrl+Shift+P` →
**TypeScript: Restart TS Server**.

### Confirm the plugin actually loaded

If nothing lights up, check that tsserver loaded the plugin:
`Cmd/Ctrl+Shift+P` → **TypeScript: Open TS Server Log** (verbose logging is on
in this project's settings), then search the log for `shortwind` /
`ts-plugin`. You should see it being enabled. Two common reasons it wouldn't:

- **Not using the workspace TypeScript** — a plugin only loads under the
  workspace TS, not the editor's bundled copy (see step 3 above). The TS version
  shows in the status bar when a `.ts`/`.tsx` file is focused.
- **Stale build** — re-run `pnpm --filter @shortwind/cli build`, then Restart TS
  Server.

## What you should see

| In `Demo.tsx` | Expected |
| --- | --- |
| **1** — type `@` inside the empty `className=""` | a completion list of the project's recipes (`@badge`, `@btn-primary`, `@stack-md`, …) pops *without* `Ctrl+Space` |
| **2** — hover `@badge` | a tooltip with its full Tailwind expansion |
| **3** — the `@badeg` typo | a warning squiggle + lightbulb → "Change '@badeg' to '@badge'" |
| **4** — `F12` / Cmd-click `@btn-primary` | jumps to its `@recipe` block in `recipes/button.css` |
| **5** — `@container @md:flex @min-[400px]:grid` | **no** squiggle — Tailwind's own `@`-utilities are left alone |

Completion auto-popping inside the string relies on `editor.quickSuggestions:
{ "strings": true }` (already set in `.vscode/settings.json` — what `init`
writes). Edit a recipe in `recipes/*.css` and the completions/hover update live.

> This is exactly what `shortwind init` wires for any TS project: the
> `tsconfig` plugin entry, the `quickSuggestions` setting, and the recipes — no
> marketplace extension, no extra install (the plugin ships inside
> `@shortwind/cli`, which `init` already installs).
