import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { computeBodySha, extractHeader } from "../fingerprint.js";
import { readLockfile } from "../lockfile.js";
import { installedFamilies, readConfig } from "../project.js";

export type VerifyIssue =
  | { family: string; kind: "missing-header"; file: string }
  | { family: string; kind: "header-tampered"; file: string; recorded: string; actual: string }
  | { family: string; kind: "lockfile-mismatch"; file: string; locked: string; actual: string }
  | { family: string; kind: "missing-lock-entry"; file: string }
  | { family: string; kind: "missing-file"; file: string };

export type VerifyOptions = {
  cwd: string;
};

export type VerifyResult = {
  ok: boolean;
  checked: string[];
  issues: VerifyIssue[];
};

export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);

  const installed = installedFamilies(recipesDir);
  const lock = await readLockfile(recipesDir);
  const issues: VerifyIssue[] = [];

  const seen = new Set<string>();
  for (const family of installed) {
    seen.add(family);
    const filePath = path.join(recipesDir, `${family}.css`);
    const source = readFileSync(filePath, "utf8");
    const header = extractHeader(source);
    if (!header) {
      issues.push({ family, kind: "missing-header", file: filePath });
      continue;
    }
    const actual = computeBodySha(source);
    if (header.sha !== actual) {
      issues.push({
        family,
        kind: "header-tampered",
        file: filePath,
        recorded: header.sha,
        actual,
      });
    }
    const locked = lock.families[family];
    if (!locked) {
      issues.push({ family, kind: "missing-lock-entry", file: filePath });
    } else if (locked.sha !== actual) {
      issues.push({
        family,
        kind: "lockfile-mismatch",
        file: filePath,
        locked: locked.sha,
        actual,
      });
    }
  }

  for (const family of Object.keys(lock.families)) {
    if (seen.has(family)) continue;
    const filePath = path.join(recipesDir, `${family}.css`);
    if (!existsSync(filePath)) {
      issues.push({ family, kind: "missing-file", file: filePath });
    }
  }

  return { ok: issues.length === 0, checked: installed, issues };
}
