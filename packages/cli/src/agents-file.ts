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

// ---------------------------------------------------------------------------
// Retiring the hosting pointer we used to write here.
//
// Between beta.20 and beta.26 this module appended a line naming
// `shortwind cloud publish`. Those verbs are gone. Dropping the writer only
// spares people who never ran those versions: everyone else has the line
// committed to their repo, where an agent reads it on every task and runs a
// command that no longer exists. So the line has to come back out.
//
// The marker is the published line's own text, which is the proof of
// authorship: nothing but our writer produced it. A hand-written line quoting
// the same dead command is removed too, and that is correct — it is equally
// wrong.
// ---------------------------------------------------------------------------

const RETIRED_MARKER = "shortwind cloud publish";

/**
 * Drop every line carrying `marker`, and the blank line the removal would
 * otherwise strand.
 *
 * The old writer used a blank-line separator when the file did not already end
 * in one, so the retired line can sit alone in its own paragraph. Removing just
 * the line would leave two consecutive blanks, i.e. our cleanup would be as
 * visible in the diff as our mistake. Scanning backwards keeps the indices
 * valid across splices.
 */
function stripMarkedLines(text: string, marker: string): { text: string; removed: boolean } {
  const lines = text.split("\n");
  let removed = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]!.includes(marker)) continue;
    removed = true;
    const orphanedBlank =
      i > 0 && i < lines.length - 1 && lines[i - 1]!.trim() === "" && lines[i + 1]!.trim() === "";
    lines.splice(i, orphanedBlank ? 2 : 1);
  }
  return { text: lines.join("\n"), removed };
}

/**
 * Remove the retired hosting pointer from this project's agent-instructions
 * files. Returns the files actually rewritten (empty when there was nothing to
 * do), so the caller can tell the user which of their files changed.
 *
 * Runs before every command rather than only on re-init: the people carrying
 * the line are precisely the ones who already ran `init` and have no reason to
 * run it again. It creates nothing, rewrites only a file that already contains
 * the marker, and never throws — this fires in whatever directory the user
 * happens to be in, and a read-only checkout must not take the CLI down.
 */
export async function retireCloudGuidance(cwd: string): Promise<string[]> {
  const cleaned: string[] = [];
  for (const name of CANDIDATES) {
    const file = path.join(cwd, name);
    try {
      if (!existsSync(file)) continue;
      const current = await readFile(file, "utf8");
      if (!current.includes(RETIRED_MARKER)) continue;
      const next = stripMarkedLines(current, RETIRED_MARKER);
      if (!next.removed) continue;
      await writeFile(file, next.text);
      cleaned.push(file);
    } catch {
      // Unreadable, unwritable, or gone between the check and the read.
    }
  }
  return cleaned;
}

/** The one-time notice shown when {@link retireCloudGuidance} rewrote a file. */
export function guidanceRetirementNotice(cleaned: string[]): string {
  return (
    `removed a stale hosting instruction from ${cleaned.join(", ")}\n` +
    `  It named \`shortwind cloud publish\`, a command this CLI no longer has, ` +
    `and your coding agent would have tried to run it.\n`
  );
}

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
