import type { ModelClient, GenerateOptions, Generation } from "./openrouter.js";
import type { EvalTask } from "./tasks.js";

// A deterministic, keyless stand-in for a real model. It exists so the whole
// harness — orchestrator, grader, report — runs end-to-end for free in CI and
// local smoke tests.
//
// It is an explicit SIMULATION, not evidence: it models the hypothesis by
// reaching for a confusable's wrong name in the control condition and the right
// name in the guided condition (detected by the selection hint the guided
// SKILL.md carries). A real OpenRouter run is the only thing that confirms or
// refutes that the guidance actually helps.

// Emitted by renderSkillMarkdown only when at least one family ships guidance.
const GUIDANCE_MARKER = "Read it before picking";

export function createOfflineClient(tasks: EvalTask[], modelId = "offline/sim"): ModelClient {
  const byPrompt = new Map(tasks.map((t) => [t.prompt, t]));
  return {
    id: modelId,
    async generate(opts: GenerateOptions): Promise<Generation> {
      const system = opts.messages.find((m) => m.role === "system")?.content ?? "";
      const userPrompt = opts.messages.find((m) => m.role === "user")?.content ?? "";
      const guided = system.includes(GUIDANCE_MARKER);
      const task = byPrompt.get(userPrompt);
      const text = task ? simulate(task, guided) : `<div className="@card">${userPrompt}</div>`;
      return { text, model: modelId, usage: null };
    },
  };
}

function simulate(task: EvalTask, guided: boolean): string {
  // Correct recipes the simulated model always gets right, minus any that a
  // confusable will stand in for, so we don't emit the same recipe twice.
  const replaced = new Set(task.confusables.map((c) => c.right));
  const base = task.recipes.filter((r) => !replaced.has(r));
  const confusable = task.confusables.map((c) => (guided ? c.right : c.wrong));

  // One recipe per element, nested, so a realistic tree is produced — putting
  // every recipe on a single <div> would trip sibling-overlap/conflict rules
  // and muddy the offline metrics. The first recipe owns the container; the
  // rest become children, each with a raw utility so density stays < 100%.
  const all = [...base, ...confusable];
  const root = all[0] ?? "card";
  const children = all.slice(1);

  // mt-2 is in no recipe expansion, so it adds raw-utility weight (keeping
  // density < 100%) without tripping the redundant-utility rule.
  const childMarkup = children
    .map((r) => `    <div className="@${r} mt-2" />`)
    .join("\n");
  return [
    `<div className="@${root}">`,
    `  {/* ${task.title} (simulated) */}`,
    childMarkup,
    `</div>`,
  ].join("\n");
}
