import * as p from "@clack/prompts";
import pc from "picocolors";
import { cac } from "cac";
import { add } from "./commands/add.js";
import { build, BuildError } from "./commands/build.js";
import { dev } from "./commands/dev.js";
import { remove } from "./commands/remove.js";
import { preset as runPreset } from "./commands/preset.js";
import { ls, formatLsText } from "./commands/ls.js";
import {
  upgrade,
  UpgradeError,
  type TouchedContext,
  type UpgradeChoice,
} from "./commands/upgrade.js";
import { verify } from "./commands/verify.js";
import { lint, formatFindingsText, ALL_RULES, type Rule } from "./commands/lint.js";
import { init, type InitOptions, DEFAULT_REGISTRY } from "./init.js";
import { bench, formatBenchTable } from "./commands/bench.js";

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
      printInitSummary(result);
    });

  cli
    .command("add <...families>", "Install one or more families")
    .option("--as <name>", "Rename the family on install (requires a single family)")
    .option("--all", "Install every family in the registry")
    .option("--force", "Overwrite existing files")
    .option("--registry <url>", "Registry origin")
    .option("--cwd <dir>", "Working directory")
    .action(
      async (
        families: string[],
        opts: { as?: string; all?: boolean; force?: boolean; registry?: string; cwd?: string },
      ) => {
        const addOptions: Parameters<typeof add>[0] = {
          cwd: opts.cwd ?? process.cwd(),
          families,
        };
        if (opts.as !== undefined) addOptions.as = opts.as;
        if (opts.all) addOptions.all = true;
        if (opts.force) addOptions.force = true;
        if (opts.registry !== undefined) addOptions.registry = opts.registry;
        const result = await add(addOptions);
        for (const fam of result.added) p.log.success(`added ${fam}`);
        for (const fam of result.overwritten) p.log.success(`overwrote ${fam}`);
        for (const fam of result.skipped) p.log.warn(`${fam} already exists (use --force)`);
        for (const missing of result.missingDependencies) {
          p.log.warn(
            `${missing.family} references unknown recipes: ${missing.references.join(", ")}`,
          );
        }
      },
    );

  cli
    .command("remove <...families>", "Remove installed families")
    .option("--cwd <dir>", "Working directory")
    .action(async (families: string[], opts: { cwd?: string }) => {
      const result = await remove({ cwd: opts.cwd ?? process.cwd(), families });
      for (const fam of result.removed) p.log.success(`removed ${fam}`);
      for (const fam of result.notFound) p.log.warn(`${fam} is not installed`);
      for (const broken of result.brokenDependents) {
        p.log.warn(
          `${broken.dependent} references removed recipes: ${broken.references.join(", ")}`,
        );
      }
    });

  cli
    .command("preset <name>", "Install every family in the named preset (additive)")
    .option("--registry <url>", "Registry origin")
    .option("--cwd <dir>", "Working directory")
    .action(async (name: string, opts: { registry?: string; cwd?: string }) => {
      const presetOptions: Parameters<typeof runPreset>[0] = {
        cwd: opts.cwd ?? process.cwd(),
        name,
      };
      if (opts.registry !== undefined) presetOptions.registry = opts.registry;
      const result = await runPreset(presetOptions);
      p.log.info(`preset ${name}: ${result.added.length} added, ${result.skipped.length} already present`);
    });

  cli
    .command("ls", "List installed and available families")
    .option("--installed", "Only installed")
    .option("--available", "Only available")
    .option("--json", "Emit JSON")
    .option("--registry <url>", "Registry origin")
    .option("--cwd <dir>", "Working directory")
    .action(
      async (opts: {
        installed?: boolean;
        available?: boolean;
        json?: boolean;
        registry?: string;
        cwd?: string;
      }) => {
        const lsOptions: Parameters<typeof ls>[0] = {
          cwd: opts.cwd ?? process.cwd(),
        };
        if (opts.installed) lsOptions.installedOnly = true;
        if (opts.available) lsOptions.availableOnly = true;
        if (opts.registry !== undefined) lsOptions.registry = opts.registry;
        const result = await ls(lsOptions);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          process.stdout.write(formatLsText(result) + "\n");
        }
      },
    );

  cli
    .command("build", "Regenerate SKILL.md from ./recipes/")
    .option("--cwd <dir>", "Working directory")
    .action(async (opts: { cwd?: string }) => {
      try {
        const result = await build({ cwd: opts.cwd ?? process.cwd() });
        if (result.changed) p.log.success(`regenerated ${result.families.length} families`);
        else p.log.info(`up to date (${result.families.length} families)`);
      } catch (err) {
        if (err instanceof BuildError) {
          process.stderr.write(err.message + "\n");
          process.exit(1);
        }
        throw err;
      }
    });

  cli
    .command("dev", "Watch ./recipes/ and regenerate SKILL.md on change")
    .option("--cwd <dir>", "Working directory")
    .option("--once", "Run build once and exit")
    .action(async (opts: { cwd?: string; once?: boolean }) => {
      if (opts.once) {
        try {
          await build({ cwd: opts.cwd ?? process.cwd() });
        } catch (err) {
          if (err instanceof BuildError) {
            process.stderr.write(err.message + "\n");
            process.exit(1);
          }
          throw err;
        }
        return;
      }
      const controller = new AbortController();
      const onSigint = (): void => controller.abort();
      process.on("SIGINT", onSigint);
      try {
        const { stop } = await dev({
          cwd: opts.cwd ?? process.cwd(),
          signal: controller.signal,
          onStatus: (status) => {
            if (status.kind === "rebuilt") {
              const msg = `✓ regenerated ${status.families.length} families${status.changed ? "" : " (no changes)"}`;
              process.stdout.write(msg + "\n");
            } else if (status.kind === "ready") {
              process.stdout.write(`watching ${status.recipesDir}\n`);
            } else {
              process.stderr.write(status.message + "\n");
            }
          },
        });
        // Block until SIGINT (or otherwise aborted), then close the watcher
        // and exit cleanly — without this the listener stays attached and
        // controller.abort() never returns control to the CLI.
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) resolve();
          else controller.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await stop();
      } finally {
        process.off("SIGINT", onSigint);
      }
      process.exit(0);
    });

  cli
    .command("upgrade [...families]", "Pull registry updates into ./recipes")
    .option("--check", "Read-only — print drift summary and exit nonzero on updates")
    .option("--force", "Skip touched-detection; overwrite local edits")
    .option("--registry <url>", "Registry origin")
    .option("--cwd <dir>", "Working directory")
    .action(
      async (
        families: string[],
        opts: { check?: boolean; force?: boolean; registry?: string; cwd?: string },
      ) => {
        try {
          const upgradeOptions: Parameters<typeof upgrade>[0] = {
            cwd: opts.cwd ?? process.cwd(),
            families,
          };
          if (opts.check) upgradeOptions.check = true;
          if (opts.force) upgradeOptions.force = true;
          if (opts.registry !== undefined) upgradeOptions.registry = opts.registry;
          if (!opts.check && !opts.force) {
            upgradeOptions.resolver = makeInteractiveResolver();
          }
          const result = await upgrade(upgradeOptions);
          printUpgradeSummary(result.outcomes);
          if (opts.check) {
            if (result.hasUpdates || result.hasTouched) process.exit(1);
          }
        } catch (err) {
          if (err instanceof UpgradeError) {
            process.stderr.write(err.message + "\n");
            process.exit(2);
          }
          throw err;
        }
      },
    );

  cli
    .command("verify", "Check installed recipes against fingerprint headers and lockfile")
    .option("--cwd <dir>", "Working directory")
    .action(async (opts: { cwd?: string }) => {
      const result = await verify({ cwd: opts.cwd ?? process.cwd() });
      if (result.ok) {
        p.log.success(`verified ${result.checked.length} families`);
        return;
      }
      for (const issue of result.issues) {
        const desc = describeVerifyIssue(issue);
        process.stderr.write(`${issue.family}: ${desc}\n`);
      }
      process.exit(1);
    });

  cli
    .command("lint", "Static analysis over source files and recipes")
    .option("--fix", "Apply auto-fixes where supported")
    .option("--rule <rule>", "Only run the named rule (repeatable)")
    .option("--json", "Emit machine-readable JSON")
    .option("--cwd <dir>", "Working directory")
    .action(
      async (opts: { fix?: boolean; rule?: string | string[]; json?: boolean; cwd?: string }) => {
        const requested = opts.rule === undefined ? [] : Array.isArray(opts.rule) ? opts.rule : [opts.rule];
        for (const r of requested) {
          if (!ALL_RULES.includes(r as Rule)) {
            process.stderr.write(`unknown rule: ${r}\n`);
            process.stderr.write(`available: ${ALL_RULES.join(", ")}\n`);
            process.exit(2);
          }
        }
        const lintOptions: Parameters<typeof lint>[0] = { cwd: opts.cwd ?? process.cwd() };
        if (opts.fix) lintOptions.fix = true;
        if (requested.length > 0) lintOptions.rules = requested as Rule[];
        const result = await lint(lintOptions);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          const text = formatFindingsText(result.findings);
          if (text) process.stdout.write(text + "\n");
          for (const f of result.filesFixed) p.log.success(`fixed ${f}`);
          if (result.findings.length === 0) p.log.success("no findings");
        }
        if (!result.ok) process.exit(1);
      },
    );

  cli
    .command("bench [path]", "Benchmark token savings in a corpus or target directory")
    .option("--corpus", "Run benchmark on the built-in corpus")
    .option("--json", "Emit machine-readable JSON")
    .option("--cwd <dir>", "Working directory")
    .action(async (pathArg: string | undefined, opts: { corpus?: boolean; json?: boolean; cwd?: string }) => {
      const benchOptions: Parameters<typeof bench>[0] = { cwd: opts.cwd ?? process.cwd() };
      if (opts.corpus) benchOptions.corpus = true;
      if (opts.json) benchOptions.json = true;
      if (pathArg !== undefined) benchOptions.path = pathArg;
      const result = await bench(benchOptions);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        const text = formatBenchTable(result);
        process.stdout.write(text + "\n");
      }
    });

  cli.help();
  cli.version("0.0.0");
  cli.parse(argv);
}

function makeInteractiveResolver() {
  return async (ctx: TouchedContext): Promise<UpgradeChoice> => {
    process.stdout.write(
      pc.yellow(`\n${ctx.family}: locally modified — incoming ${ctx.incoming.version}\n`),
    );
    const choice = await p.select({
      message: `Resolve ${ctx.family}`,
      options: [
        { value: "accept", label: "Accept new (discard local edits)" },
        { value: "keep", label: "Keep yours" },
        { value: "skip", label: "Skip for now" },
      ],
    });
    if (p.isCancel(choice)) return "skip";
    return choice as UpgradeChoice;
  };
}

function printUpgradeSummary(outcomes: Awaited<ReturnType<typeof upgrade>>["outcomes"]): void {
  for (const o of outcomes) {
    if (o.action === "updated") {
      process.stdout.write(pc.green(`✓ ${o.family} ${o.from} → ${o.to}\n`));
    } else if (o.action === "would-update") {
      process.stdout.write(pc.cyan(`→ ${o.family} ${o.from} → ${o.to} (available)\n`));
    } else if (o.action === "would-review") {
      process.stdout.write(pc.yellow(`! ${o.family} ${o.from} → ${o.to} (touched; needs review)\n`));
    } else if (o.action === "kept" && o.reason === "user-chose-keep") {
      process.stdout.write(pc.dim(`  ${o.family} kept local\n`));
    } else if (o.action === "skipped") {
      process.stdout.write(pc.dim(`  ${o.family} skipped (${o.reason})\n`));
    }
  }
}

function describeVerifyIssue(issue: import("./commands/verify.js").VerifyIssue): string {
  switch (issue.kind) {
    case "missing-header":
      return "no fingerprint header — recipe was hand-stripped";
    case "header-tampered":
      return `header sha ${issue.recorded} but body hashes to ${issue.actual}`;
    case "lockfile-mismatch":
      return `lockfile expects ${issue.locked} but body hashes to ${issue.actual}`;
    case "missing-lock-entry":
      return "installed but not recorded in lockfile";
    case "missing-file":
      return "in lockfile but file is missing";
  }
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

function printInitSummary(result: Awaited<ReturnType<typeof init>>): void {
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
