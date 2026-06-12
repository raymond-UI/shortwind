import path from "node:path";
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
import { doctor } from "./commands/doctor.js";
import { detectProject, type Bundler } from "./detect.js";
import { lint, formatFindingsText, ALL_RULES, type Rule } from "./commands/lint.js";
import { init, cliVersion, type InitOptions, DEFAULT_REGISTRY } from "./init.js";
import { bench, formatBenchTable } from "./commands/bench.js";
import { newFamily, NewFamilyError } from "./commands/new.js";
import { reseal } from "./commands/reseal.js";

const KNOWN_PRESETS = ["starter", "app", "content", "all", "none"];
export const DEFAULT_PRESET = "starter";

// Decide the init preset without forcing a TTY: an explicit --preset wins,
// --yes/-y takes the default, and only the bare interactive call prompts —
// agents and CI run `init --yes` unattended (#68).
export async function resolveInitPreset(
  opts: { preset?: string; yes?: boolean },
  prompt: () => Promise<string>,
): Promise<string> {
  if (opts.preset !== undefined) return opts.preset;
  if (opts.yes) return DEFAULT_PRESET;
  return prompt();
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = cac("shortwind");

  cli
    .command("init", "Bootstrap Shortwind in this project")
    .option("--preset <name>", "Preset to install (starter|app|content|all|none)")
    .option("-y, --yes", `Skip prompts and use the default preset (${DEFAULT_PRESET})`)
    .option("--registry <url>", "Registry origin", { default: DEFAULT_REGISTRY })
    .option("--cwd <dir>", "Working directory", { default: process.cwd() })
    .action(async (opts: { preset?: string; yes?: boolean; registry?: string; cwd?: string }) => {
      const preset = await resolveInitPreset(opts, promptForPreset);
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
    .command("new <family>", "Scaffold a new custom recipe family file")
    .option("--force", "Overwrite an existing family file")
    .option("--cwd <dir>", "Working directory")
    .action(async (family: string, opts: { force?: boolean; cwd?: string }) => {
      try {
        const result = await newFamily({
          cwd: opts.cwd ?? process.cwd(),
          family,
          ...(opts.force ? { force: true } : {}),
        });
        p.log.success(`created ${result.familyPath}`);
        p.log.info(`regenerated ${result.skillPath} — edit the recipes, then \`shortwind build\` to refresh.`);
      } catch (err) {
        if (err instanceof NewFamilyError) {
          process.stderr.write(err.message + "\n");
          process.exit(1);
        }
        throw err;
      }
    });

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
    .command("reseal [...families]", "Re-sign recipes after intentional edits (updates header sha + lockfile)")
    .option("--cwd <dir>", "Working directory")
    .action(async (families: string[], opts: { cwd?: string }) => {
      const result = await reseal({ cwd: opts.cwd ?? process.cwd(), families });
      for (const f of result.resealed) p.log.success(`resealed ${f}`);
      for (const f of result.unchanged) p.log.info(`${f} already sealed`);
      for (const f of result.notFound) p.log.warn(`${f} is not installed`);
      for (const f of result.noHeader) p.log.warn(`${f} has no fingerprint header`);
      if (result.resealed.length === 0 && result.unchanged.length > 0 && result.notFound.length === 0) {
        p.log.success("all recipes already sealed");
      }
    });

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
    .command("doctor", "Scan build output for unexpanded @recipe tokens")
    .option("--dir <path>", "Output directory to scan (repeatable; default: .next, dist, out, build)")
    .option("--json", "Emit machine-readable JSON")
    .option("--cwd <dir>", "Working directory")
    .action(async (opts: { dir?: string | string[]; json?: boolean; cwd?: string }) => {
      const cwd = opts.cwd ?? process.cwd();
      const doctorOptions: Parameters<typeof doctor>[0] = { cwd };
      if (opts.dir !== undefined) {
        doctorOptions.dirs = Array.isArray(opts.dir) ? opts.dir : [opts.dir];
      }
      const result = await doctor(doctorOptions);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        printDoctorReport(result, cwd);
      }
      if (result.verdict === "no-output") process.exit(2);
      if (!result.ok) process.exit(1);
    });

  cli
    .command("lint", "Static analysis over source files and recipes")
    .option("--fix", "Apply auto-fixes where supported")
    .option("--rule <rule>", "Only run the named rule (repeatable)")
    .option("--content <glob>", "Source glob to scan for recipe usage (repeatable; overrides config)")
    .option("--json", "Emit machine-readable JSON")
    .option("--cwd <dir>", "Working directory")
    .action(
      async (opts: {
        fix?: boolean;
        rule?: string | string[];
        content?: string | string[];
        json?: boolean;
        cwd?: string;
      }) => {
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
        if (opts.content !== undefined) {
          lintOptions.content = Array.isArray(opts.content) ? opts.content : [opts.content];
        }
        const result = await lint(lintOptions);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          const text = formatFindingsText(result.findings);
          if (text) process.stdout.write(text + "\n");
          for (const f of result.filesFixed) p.log.success(`fixed ${f}`);
          if (result.scannedFiles === 0) {
            p.log.warn(
              `content scan matched no source files — usage rules (recipe/unused) were skipped.\n` +
                `Point lint at your sources with "content" in shortwind.config.json or --content <glob>.`,
            );
          }
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
  cli.version(cliVersion() ?? "0.0.0");
  // cac's parse() invokes the matched command's async action but does NOT await
  // it, so a rejection inside any async command (network failure in `add`, a
  // rethrow in `build`/`upgrade`, …) escapes bin.ts's `run().catch` and prints
  // a raw unhandled-rejection dump. Parse without running, then await the
  // command so its promise flows back to the caller's catch.
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
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

// The whole point of doctor (#84) is telling "you forgot to wire the adapter"
// apart from "the adapter ran and something leaked" — both otherwise present
// as a green build that ships raw @recipe text.
function printDoctorReport(result: Awaited<ReturnType<typeof doctor>>, cwd: string): void {
  if (result.verdict === "no-output") {
    p.log.error(
      `no build output found (looked for .next/, dist/, out/, build/).\n` +
        `Run your framework's build first, or point doctor at it with --dir <path>.`,
    );
    return;
  }
  if (result.verdict === "clean") {
    p.log.success(
      `no unexpanded recipe tokens in ${result.outputDirs.join(", ")} (${result.scannedFiles} files scanned)`,
    );
    return;
  }
  for (const f of result.findings) {
    process.stderr.write(`${path.relative(cwd, f.file)}: ${f.tokens.join(", ")}\n`);
  }
  const tokenCount = new Set(result.findings.flatMap((f) => f.tokens)).size;
  if (result.verdict === "not-wired") {
    const bundler = detectProject(cwd).bundler;
    p.log.error(
      `found ${tokenCount} raw @recipe token${tokenCount === 1 ? "" : "s"} in build output and ` +
        `every recipe your source references is among them — it looks like no Shortwind ` +
        `transform ran during the build.\n` +
        `Is the adapter wired? ${adapterHint(bundler)}\n` +
        `Setup guide: ${setupGuideUrl(bundler)}`,
    );
  } else {
    p.log.error(
      `found ${tokenCount} raw @recipe token${tokenCount === 1 ? "" : "s"} in build output. ` +
        `The Shortwind transform ran (other recipes expanded), so these specific tokens ` +
        `escaped it — typically a className built from a variable/prop/template, or markup ` +
        `in a region the expander treats as opaque.\n` +
        `See https://shortwind.dev/docs/dynamic-classes`,
    );
  }
}

// Slugs match site/src/content/docs/setup-<bundler>.md (#85).
function setupGuideUrl(bundler: Bundler): string {
  return bundler === "unknown"
    ? "https://shortwind.dev/docs/install"
    : `https://shortwind.dev/docs/setup-${bundler}`;
}

function adapterHint(bundler: Bundler): string {
  switch (bundler) {
    case "next":
      return "Next needs `export default withShortwind()(nextConfig)` in next.config — note the call is curried.";
    case "vite":
      return "Vite needs `shortwind()` in the vite.config plugins array: `plugins: [shortwind(), tailwindcss(), ...]`.";
    case "astro":
      return "Astro needs `shortwind()` in astro.config `integrations`.";
    default:
      return "Add the Shortwind plugin for your bundler (see the setup guide).";
  }
}

function describeVerifyIssue(issue: import("./commands/verify.js").VerifyIssue): string {
  switch (issue.kind) {
    case "missing-header":
      return "no fingerprint header — recipe was hand-stripped";
    case "header-tampered":
      return `header sha ${issue.recorded} but body hashes to ${issue.actual}`;
    case "legacy-fingerprint":
      return `sealed with an older fingerprint format (${issue.recorded}) — run \`shortwind reseal\` to upgrade it (the recipe body is unchanged)`;
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

function installCmd(pm: Awaited<ReturnType<typeof init>>["packageManager"]): string {
  switch (pm) {
    case "bun":
      return "bun add -d";
    case "npm":
      return "npm install -D";
    default:
      return `${pm} add -D`;
  }
}

function printInitSummary(result: Awaited<ReturnType<typeof init>>): void {
  p.note(
    [
      `preset:            ${result.preset}`,
      `registry:          ${result.registry}`,
      `package manager:   ${result.packageManager}`,
      `families copied:   ${result.installedFamilies.length}`,
      `families skipped:  ${result.skippedFamilies.length}`,
      `adapters:          ${result.installOk ? result.installedPackages.join(", ") || "none" : "install failed — see below"}`,
      ``,
      `config:            ${result.configPath}`,
      `vscode settings:   ${result.vscodePath}`,
      `pre-commit:        ${result.huskyPath ?? "skipped (not a git repository)"}`,
      `SKILL.md:          ${result.skillPath}`,
      `theme:             ${describeTheme(result)}`,
      `bundler config:    ${describeBundlerConfig(result)}`,
      `agent guide:       ${describeAgentsFile(result)}`,
    ].join("\n"),
    "shortwind init",
  );
  if (!result.installOk) {
    const v = cliVersion();
    const specs = result.installedPackages.map((p) => (v ? `${p}@${v}` : p)).join(" ");
    p.log.warn(
      `Couldn't auto-install adapters (your recipes and config were still scaffolded).\n` +
        `Finish by installing them yourself:\n\n` +
        `  ${installCmd(result.packageManager)} ${specs}\n\n` +
        `(${result.installError ?? "unknown error"})`,
    );
  }
  if (result.bundlerConfigAction === "manual" && result.bundlerConfigSnippet) {
    p.log.warn(`Add the plugin to your bundler config:\n\n${result.bundlerConfigSnippet}`);
  }
  p.log.info(`Setup guide for your stack: ${setupGuideUrl(result.bundler)}`);
  if (result.themeAction === "supplemented") {
    p.log.info(
      `Your theme (${result.themePath}) didn't define ${result.supplementedThemeTokens.length} design token${result.supplementedThemeTokens.length === 1 ? "" : "s"} the installed recipes use:\n\n` +
        `  ${result.supplementedThemeTokens.join(", ")}\n\n` +
        `Appended them with neutral placeholder values (marked block at the end of the file) so recipes render on first run — tune them to your palette.\n` +
        `Reference values: https://shortwind.dev/docs/install#theme-tokens`,
    );
  }
  if (result.missingThemeTokens.length > 0) {
    p.log.warn(
      `Your existing theme (${result.themePath}) does not define ${result.missingThemeTokens.length} design token${result.missingThemeTokens.length === 1 ? "" : "s"} the installed recipes use:\n\n` +
        `  ${result.missingThemeTokens.join(", ")}\n\n` +
        `Recipes referencing them will render colorless until you add the tokens to your @theme.\n` +
        `The default token block is documented at https://shortwind.dev/docs/install#theme-tokens`,
    );
  }
  p.outro(
    `Next: run \`${devCmd(result.packageManager)}\` and check a recipe renders. After a production build, \`npx shortwind doctor\` verifies nothing shipped unexpanded.`,
  );
}

// `npm dev` is not a thing — npm needs the `run` form; pnpm/yarn/bun accept
// the bare script name.
function devCmd(pm: Awaited<ReturnType<typeof init>>["packageManager"]): string {
  return pm === "npm" ? "npm run dev" : `${pm} dev`;
}

function describeAgentsFile(result: Awaited<ReturnType<typeof init>>): string {
  switch (result.agentsFileAction) {
    case "created":
      return `wrote ${result.agentsFilePath}`;
    case "appended":
      return `added recipe pointer to ${result.agentsFilePath}`;
    case "skipped":
      return `pointer already in ${result.agentsFilePath}`;
  }
}

function describeBundlerConfig(result: Awaited<ReturnType<typeof init>>): string {
  switch (result.bundlerConfigAction) {
    case "patched":
      return `plugin added to ${result.bundlerConfigPath}`;
    case "manual":
      return "needs a manual edit (see below)";
    case "skipped":
      return result.bundlerConfigPath
        ? `already wired in ${result.bundlerConfigPath}`
        : "skipped (no supported bundler)";
  }
}

function describeTheme(result: Awaited<ReturnType<typeof init>>): string {
  switch (result.themeAction) {
    case "injected":
      return `tokens added to ${result.themePath}`;
    case "created":
      return `wrote ${result.themePath}`;
    case "supplemented":
      return `kept your theme; appended ${result.supplementedThemeTokens.length} missing tokens to ${result.themePath}`;
    case "skipped":
      return result.themePath
        ? `left existing theme in ${result.themePath} untouched`
        : "skipped (no Tailwind v4 CSS entry — define color tokens yourself)";
  }
}
