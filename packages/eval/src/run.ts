import { writeFileSync } from "node:fs";
import { loadCatalog, type Condition } from "./registry.js";
import { TASKS, type EvalTask } from "./tasks.js";
import { buildMessages } from "./prompts.js";
import { createGrader } from "./grader.js";
import { createOfflineClient } from "./offline.js";
import { createOpenRouterClient, type ModelClient } from "./openrouter.js";
import { buildReport, formatReport, type TaskResult } from "./report.js";

type CliArgs = {
  models: string[];
  offline: boolean;
  tasks: string[] | null;
  limit: number | null;
  out: string | null;
  json: boolean;
  maxTokens: number;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    models: [],
    offline: false,
    tasks: null,
    limit: null,
    out: null,
    json: false,
    // Outputs are small JSX snippets. Capping max_tokens keeps cost down and,
    // crucially, stops reasoning models from reserving their full context (which
    // a credit-limited key can't afford — OpenRouter 402s the whole request).
    maxTokens: 8192,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") args.offline = true;
    else if (a === "--json") args.json = true;
    else if (a === "--models") args.models = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--tasks") args.tasks = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
  }
  return args;
}

const CONDITIONS: Condition[] = ["control", "guided"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const catalog = loadCatalog();

  let tasks: EvalTask[] = args.tasks
    ? TASKS.filter((t) => args.tasks!.includes(t.id))
    : TASKS;
  if (args.limit && args.limit > 0) tasks = tasks.slice(0, args.limit);

  const apiKey = process.env["OPENROUTER_API_KEY"];
  const useOffline = args.offline || !apiKey;

  let client: ModelClient;
  let models: string[];
  if (useOffline) {
    client = createOfflineClient(TASKS);
    models = args.models.length > 0 ? args.models : ["offline/sim"];
    if (!args.offline && !apiKey) {
      process.stderr.write(
        "No OPENROUTER_API_KEY set — running the offline SIMULATOR. Results model the hypothesis, they do not confirm it.\n",
      );
    } else {
      process.stderr.write("Running the offline SIMULATOR (no API calls).\n");
    }
  } else {
    client = createOpenRouterClient({
      apiKey: apiKey!,
      referer: "https://shortwind.dev",
      title: "shortwind-eval",
    });
    models = args.models.length > 0 ? args.models : ["anthropic/claude-3.5-sonnet"];
  }

  const grader = createGrader();
  const results: TaskResult[] = [];
  let failures = 0;
  try {
    for (const model of models) {
      for (const task of tasks) {
        for (const condition of CONDITIONS) {
          const messages = buildMessages(catalog, condition, task);
          // One model/task/condition failing (a retired id, a rate limit, a
          // provider hiccup) shouldn't sink the whole run — record it and move
          // on so the rest of the matrix still produces a report.
          try {
            const gen = await client.generate({ model, messages, temperature: 0, maxTokens: args.maxTokens });
            const score = await grader.grade(gen.text);
            results.push({ model, condition, taskId: task.id, score, output: gen.text });
            process.stderr.write(
              `  ${model}  ${task.id.padEnd(18)} ${condition.padEnd(8)} ` +
                `unknown=${score.unknown} conflicts=${score.conflicts} density=${(score.recipeDensity * 100).toFixed(0)}%\n`,
            );
          } catch (err) {
            failures++;
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`  ${model}  ${task.id.padEnd(18)} ${condition.padEnd(8)} FAILED: ${msg}\n`);
          }
        }
      }
    }
  } finally {
    grader.dispose();
  }
  if (failures > 0) process.stderr.write(`\n${failures} generation(s) failed and were skipped.\n`);

  const reports = buildReport(results);
  if (args.json) {
    process.stdout.write(JSON.stringify({ reports, results }, null, 2) + "\n");
  } else {
    process.stdout.write(formatReport(reports) + "\n");
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ reports, results }, null, 2));
    process.stderr.write(`\nWrote raw results to ${args.out}\n`);
  }
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + "\n");
  process.exit(1);
});
