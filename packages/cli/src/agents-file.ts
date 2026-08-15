import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Even with SKILL.md present, agents under-reach for recipes (writing raw
// `flex items-center gap-*` instead of `@row`). A one-line pointer in the
// project's agent-instructions file — where coding agents already look — nudges
// them to the catalog without bloating their context.

// Recognisable substring used to detect a pointer we already wrote, so the line
// is never duplicated on re-init.
const MARKER = "skills/shortwind/SKILL.md";
// Separate marker for the dynamic-classes guidance (#81), so projects whose
// AGENTS.md predates it still get the new line appended on re-init.
const DYNAMIC_MARKER = "expandClassList";

function line(skillRel: string): string {
  return `For UI, prefer Shortwind \`@recipe\` class names (e.g. \`@card\`, \`@btn-primary\`, \`@row\`) over raw Tailwind where a recipe fits — full catalog in \`${skillRel}\`.`;
}

// Every beta.11 dogfooding agent routed around dynamic recipes with raw
// Tailwind and wished for a leak gate that already shipped (#81) — name both
// features where agents actually look, pointing at the worked SKILL.md
// snippets.
function dynamicLine(): string {
  return (
    `Never build a recipe name dynamically (variable, prop, concatenation) — it silently won't expand. ` +
    `For a runtime choice between recipes use the \`rc()\`/\`expandClassList\` helper, and turn on \`strict: true\` ` +
    `in the Shortwind adapter config to fail the build on leaked \`@tokens\` — worked snippets under "Dynamic classes" in the SKILL doc above.`
  );
}

// Files coding agents read for project instructions, in preference order.
const CANDIDATES = ["AGENTS.md", "CLAUDE.md"];

export type AgentsFileAction = "appended" | "created" | "skipped";
export type AgentsFileResult = {
  path: string | null;
  action: AgentsFileAction;
};

export async function wireAgentsInstructions(
  cwd: string,
  skillPath: string,
): Promise<AgentsFileResult> {
  const skillRel = path.relative(cwd, skillPath).split(path.sep).join("/");
  const pointer = line(skillRel);
  const dynamic = dynamicLine();

  // Append to every existing agent-instructions file (idempotently), so the
  // nudge lands wherever the project's agent actually looks. Each line has
  // its own marker, so a file carrying only the older pointer still gains
  // the dynamic-classes guidance.
  let touched: AgentsFileResult | null = null;
  for (const name of CANDIDATES) {
    const file = path.join(cwd, name);
    if (!existsSync(file)) continue;
    const current = await readFile(file, "utf8");
    const missing: string[] = [];
    if (!current.includes(MARKER)) missing.push(pointer);
    if (!current.includes(DYNAMIC_MARKER)) missing.push(dynamic);
    if (missing.length === 0) {
      touched ??= { path: file, action: "skipped" };
      continue;
    }
    const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(file, current + sep + missing.join("\n") + "\n");
    return { path: file, action: "appended" };
  }
  if (touched) return touched;

  // None exist — create AGENTS.md (the cross-tool standard).
  const target = path.join(cwd, "AGENTS.md");
  await writeFile(target, `# AGENTS.md\n\n${pointer}\n${dynamic}\n`);
  return { path: target, action: "created" };
}
