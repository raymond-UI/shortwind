export { init, DEFAULT_REGISTRY } from "./init.js";
export type { InitOptions, InitResult, InstallPackages } from "./init.js";
export { detectProject } from "./detect.js";
export type { PackageManager, Bundler, Framework, ProjectShape } from "./detect.js";
export { createRegistrySource, resolvePresetFamilies } from "./registry-source.js";
export type { RegistrySource, Presets } from "./registry-source.js";
export { add } from "./commands/add.js";
export type { AddOptions, AddResult } from "./commands/add.js";
export { remove } from "./commands/remove.js";
export type { RemoveOptions, RemoveResult } from "./commands/remove.js";
export { newFamily, NewFamilyError } from "./commands/new.js";
export type { NewOptions, NewResult } from "./commands/new.js";
export { reseal } from "./commands/reseal.js";
export type { ResealOptions, ResealResult } from "./commands/reseal.js";
export { preset } from "./commands/preset.js";
export type { PresetOptions, PresetResult } from "./commands/preset.js";
export { ls, formatLsText } from "./commands/ls.js";
export type { LsOptions, LsResult } from "./commands/ls.js";
export { build, BuildError } from "./commands/build.js";
export type { BuildOptions, BuildResult } from "./commands/build.js";
export { dev } from "./commands/dev.js";
export type { DevOptions, DevStatus } from "./commands/dev.js";
export { upgrade, UpgradeError } from "./commands/upgrade.js";
export type {
  UpgradeOptions,
  UpgradeResult,
  UpgradeChoice,
  UpgradeResolver,
  TouchedContext,
  FamilyOutcome,
  FamilyState,
} from "./commands/upgrade.js";
export { verify } from "./commands/verify.js";
export type { VerifyOptions, VerifyResult, VerifyIssue } from "./commands/verify.js";
export { bench, formatBenchTable } from "./commands/bench.js";
export type { BenchOptions, BenchResult, FileBenchResult } from "./commands/bench.js";
export { lint, formatFindingsText, extractClassUsages, ALL_RULES } from "./commands/lint.js";
export type { LintOptions, LintResult, Finding, Rule, Severity } from "./commands/lint.js";
export { readLockfile, writeLockfile } from "./lockfile.js";
export type { Lockfile, LockEntry } from "./lockfile.js";
export {
  computeBodySha,
  extractHeader,
  rewriteHeaderSha,
  sealRecipeFile,
  buildHeaderLine,
  normalizeBody,
} from "./fingerprint.js";
export type { RecipeHeader } from "./fingerprint.js";
export { renameFamilyInSource } from "./project.js";
