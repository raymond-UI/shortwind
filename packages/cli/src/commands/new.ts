import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readConfig, regenerateSkillMd } from "../project.js";
import { assertValidFamilyName } from "../registry-source.js";

export type NewOptions = {
  cwd: string;
  family: string;
  force?: boolean;
};

export type NewResult = {
  familyPath: string;
  skillPath: string;
};

export class NewFamilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewFamilyError";
  }
}

// A minimal, valid starter family: the fingerprint header (with the source
// placeholder sha), an @guide stub, and one example recipe so the file parses,
// resolves, and shows up in SKILL.md immediately.
function template(family: string): string {
  return [
    `/* shortwind: ${family}@0.0.1 sha:000000 */`,
    ``,
    `/* @guide`,
    `   TODO: one or two lines on when to reach for these recipes, and which`,
    `   easy-to-confuse name to prefer. */`,
    ``,
    `/* TODO: describe this recipe. */`,
    `@recipe ${family} {`,
    `  p-4`,
    `}`,
    ``,
  ].join("\n");
}

export async function newFamily(options: NewOptions): Promise<NewResult> {
  assertValidFamilyName(options.family);
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const familyPath = path.join(recipesDir, `${options.family}.css`);

  if (existsSync(familyPath) && !options.force) {
    throw new NewFamilyError(
      `${path.join(config.recipesDir, `${options.family}.css`)} already exists (use --force to overwrite)`,
    );
  }

  await mkdir(recipesDir, { recursive: true });
  await writeFile(familyPath, template(options.family));

  // Fold the new family into SKILL.md so the agent/editor sees it right away.
  const skillPath = await regenerateSkillMd(cwd, config);
  return { familyPath, skillPath };
}
