#!/usr/bin/env node
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;

export const MIN_RELEASE_AGE_HOURS = 72;
export const MIN_RELEASE_AGE_MINUTES = MIN_RELEASE_AGE_HOURS * 60;

type RootPkg = {
  pnpm?: {
    minimumReleaseAge?: number;
  };
};

export function checkReleaseAge(pkg: RootPkg): { ok: true } | { ok: false; reason: string } {
  const age = pkg.pnpm?.minimumReleaseAge;
  if (age === undefined) {
    return { ok: false, reason: "pnpm.minimumReleaseAge is missing from the root package.json" };
  }
  if (typeof age !== "number") {
    return { ok: false, reason: `pnpm.minimumReleaseAge must be a number, got ${typeof age}` };
  }
  if (age < MIN_RELEASE_AGE_MINUTES) {
    return {
      ok: false,
      reason: `pnpm.minimumReleaseAge is ${age} minutes, must be ≥ ${MIN_RELEASE_AGE_MINUTES} (${MIN_RELEASE_AGE_HOURS}h)`,
    };
  }
  return { ok: true };
}

const isMain = (() => {
  try {
    return new URL(import.meta.url).pathname === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as RootPkg;
  const result = checkReleaseAge(pkg);
  if (!result.ok) {
    console.error(`Release-age policy violation: ${result.reason}`);
    console.error(
      "Lowering this threshold gives malicious releases less time to be detected. " +
        "Reduction requires explicit PR justification.",
    );
    process.exit(1);
  }
  console.log(`OK — pnpm.minimumReleaseAge = ${pkg.pnpm!.minimumReleaseAge} (≥ ${MIN_RELEASE_AGE_MINUTES} minutes).`);
}
