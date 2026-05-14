import * as p from "@clack/prompts";
import { cac } from "cac";
import { init, type InitOptions, DEFAULT_REGISTRY } from "./init.js";

const KNOWN_PRESETS = ["starter", "app", "content", "all", "none"];

export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = cac("shortwind");

  cli
    .command("init", "Bootstrap Shortwind in this project")
    .option("--preset <name>", "Preset to install (starter|app|content|all|none)")
    .option("--registry <url>", "Registry origin", { default: DEFAULT_REGISTRY })
    .option("--cwd <dir>", "Working directory", { default: process.cwd() })
    .action(async (opts: { preset?: string; registry?: string; cwd?: string }) => {
      const preset = opts.preset ?? (await promptForPreset());
      const options: InitOptions = {
        cwd: opts.cwd ?? process.cwd(),
        preset,
      };
      if (opts.registry !== undefined) options.registry = opts.registry;
      const result = await init(options);
      printSummary(result);
    });

  cli.help();
  cli.version("0.0.0");
  cli.parse(argv);
}

async function promptForPreset(): Promise<string> {
  const choice = await p.select({
    message: "Pick a preset",
    options: KNOWN_PRESETS.map((name) => ({ value: name, label: name })),
  });
  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  return choice;
}

function printSummary(result: Awaited<ReturnType<typeof init>>): void {
  p.note(
    [
      `preset:            ${result.preset}`,
      `registry:          ${result.registry}`,
      `package manager:   ${result.packageManager}`,
      `families copied:   ${result.installedFamilies.length}`,
      `families skipped:  ${result.skippedFamilies.length}`,
      ``,
      `config:            ${result.configPath}`,
      `vscode settings:   ${result.vscodePath}`,
      `pre-commit:        ${result.huskyPath}`,
      `SKILL.md:          ${result.skillPath}`,
    ].join("\n"),
    "shortwind init",
  );
  p.outro(`Next: run \`${result.packageManager} dev\` to start watching.`);
}
