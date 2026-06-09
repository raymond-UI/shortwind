import type { LoadedCatalog, Condition } from "./registry.js";
import { renderSkill } from "./registry.js";
import type { EvalTask } from "./tasks.js";
import type { ChatMessage } from "./openrouter.js";

// The model is told to behave exactly as an agent would when Shortwind is
// installed: emit a single JSX snippet using @recipe class names from the
// provided catalog. We deliberately do NOT mention the confusables — the whole
// question is whether the @guide text in the catalog (guided condition) steers
// selection without extra coaching in the task itself.
const SYSTEM_PREFIX = `You are generating a single React (JSX) UI snippet for a project that uses Shortwind — a class layer where @recipe names expand to Tailwind utilities at build time.

Rules:
- Use @recipe class names from the catalog below wherever one fits, exactly as written.
- Only use recipe names that appear in the catalog. Do not invent recipe names.
- You may add raw Tailwind utilities for anything no recipe covers.
- Output ONLY the JSX for the component — no imports, no prose, no code fences.

Catalog (SKILL.md):
`;

export function buildMessages(
  catalog: LoadedCatalog,
  condition: Condition,
  task: EvalTask,
): ChatMessage[] {
  const skill = renderSkill(catalog, condition);
  return [
    { role: "system", content: SYSTEM_PREFIX + skill },
    { role: "user", content: task.prompt },
  ];
}
