import { existsSync, readFileSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import path from "node:path";
import { resolveSource, type RegistrySource } from "../registry-source.js";
import { computeBodySha, extractHeader, rewriteHeaderSha } from "../fingerprint.js";
import { readLockfile, writeLockfile, type Lockfile } from "../lockfile.js";
import { installedFamilies, readConfig, regenerateSkillMd } from "../project.js";

export type UpgradeChoice = "accept" | "keep" | "skip";

export type TouchedContext = {
  family: string;
  local: string;
  baseline: { version: string; sha: string };
  incoming: { version: string; body: string };
};

export type UpgradeResolver = (ctx: TouchedContext) => Promise<UpgradeChoice>;

export type UpgradeOptions = {
  cwd: string;
  families?: string[];
  registry?: string;
  force?: boolean;
  check?: boolean;
  resolver?: UpgradeResolver;
  source?: RegistrySource;
};

export type FamilyState = "pristine" | "touched" | "unchanged" | "missing" | "untracked";

export type FamilyOutcome =
  | { family: string; action: "updated"; from: string; to: string; state: FamilyState }
  | { family: string; action: "kept"; reason: "unchanged" | "user-chose-keep"; state: FamilyState }
  | { family: string; action: "skipped"; reason: string; state: FamilyState }
  | { family: string; action: "would-update"; from: string; to: string; state: FamilyState }
  | { family: string; action: "would-review"; from: string; to: string; state: FamilyState };

export type UpgradeResult = {
  outcomes: FamilyOutcome[];
  hasUpdates: boolean;
  hasTouched: boolean;
  lockfile: Lockfile;
  skillPath: string | null;
};

export class UpgradeError extends Error {
  readonly errors: { family: string; message: string }[];
  constructor(errors: { family: string; message: string }[]) {
    super(`shortwind upgrade failed:\n${errors.map((e) => `  ${e.family}: ${e.message}`).join("\n")}`);
    this.errors = errors;
    this.name = "UpgradeError";
  }
}

export async function upgrade(options: UpgradeOptions): Promise<UpgradeResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const registry = options.registry ?? config.registry;
  const source = options.source ?? (await resolveSource(registry));
  const recipesDir = path.join(cwd, config.recipesDir);

  const installed = installedFamilies(recipesDir);
  const targets = options.families && options.families.length > 0 ? options.families : installed;
  const lock = await readLockfile(recipesDir);
  let lockfileDirty = false;
  if (!lock.registry) {
    lock.registry = registry;
    lockfileDirty = true;
  }

  const outcomes: FamilyOutcome[] = [];
  const errors: { family: string; message: string }[] = [];
  let hasUpdates = false;
  let hasTouched = false;
  let anyWritten = false;

  for (const family of targets) {
    const filePath = path.join(recipesDir, `${family}.css`);
    if (!existsSync(filePath)) {
      outcomes.push({
        family,
        action: "skipped",
        reason: "not installed",
        state: "missing",
      });
      continue;
    }

    let incomingBody: string;
    try {
      incomingBody = await source.loadFamily(family);
    } catch (err) {
      errors.push({ family, message: (err as Error).message });
      continue;
    }
    const incomingHeader = extractHeader(incomingBody);
    if (!incomingHeader) {
      errors.push({ family, message: "registry recipe has no fingerprint header" });
      continue;
    }
    const incomingVersion = incomingHeader.version;

    const localBody = readFileSync(filePath, "utf8");
    const localHeader = extractHeader(localBody);
    const recordedSha = localHeader?.sha ?? "";
    const actualSha = computeBodySha(localBody);
    const lockedEntry = lock.families[family];
    const lockedVersion = lockedEntry?.version ?? localHeader?.version ?? "";

    const isTouched = recordedSha !== "" && recordedSha !== actualSha;
    const state: FamilyState = isTouched
      ? "touched"
      : lockedVersion === incomingVersion
      ? "unchanged"
      : "pristine";

    if (state === "unchanged" && !isTouched) {
      outcomes.push({
        family,
        action: "kept",
        reason: "unchanged",
        state: "unchanged",
      });
      continue;
    }

    if (options.check) {
      if (isTouched) {
        hasTouched = true;
        if (lockedVersion !== incomingVersion) hasUpdates = true;
        outcomes.push({
          family,
          action: "would-review",
          from: lockedVersion,
          to: incomingVersion,
          state: "touched",
        });
      } else {
        hasUpdates = true;
        outcomes.push({
          family,
          action: "would-update",
          from: lockedVersion,
          to: incomingVersion,
          state: "pristine",
        });
      }
      continue;
    }

    if (isTouched && !options.force) {
      hasTouched = true;
      const choice = options.resolver
        ? await options.resolver({
            family,
            local: localBody,
            baseline: { version: lockedVersion, sha: recordedSha },
            incoming: { version: incomingVersion, body: incomingBody },
          })
        : "skip";
      if (choice === "keep") {
        outcomes.push({ family, action: "kept", reason: "user-chose-keep", state: "touched" });
        continue;
      }
      if (choice === "skip") {
        outcomes.push({ family, action: "skipped", reason: "touched", state: "touched" });
        continue;
      }
    }

    const newSha = computeBodySha(incomingBody);
    const sealed = rewriteHeaderSha(incomingBody, newSha);
    await atomicWrite(filePath, sealed);
    lock.families[family] = { version: incomingVersion, sha: newSha };
    outcomes.push({
      family,
      action: "updated",
      from: lockedVersion,
      to: incomingVersion,
      state: isTouched ? "touched" : "pristine",
    });
    hasUpdates = true;
    anyWritten = true;
    lockfileDirty = true;
  }

  if (errors.length > 0) throw new UpgradeError(errors);

  let skillPath: string | null = null;
  if (!options.check) {
    if (lockfileDirty) await writeLockfile(recipesDir, lock);
    if (anyWritten) skillPath = await regenerateSkillMd(cwd, config);
  }

  return { outcomes, hasUpdates, hasTouched, lockfile: lock, skillPath };
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  const tmp = filePath + ".tmp";
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(body);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, filePath);
}
