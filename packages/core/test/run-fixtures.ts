import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Recipe } from "../src/types.js";
import type { ExpandMode } from "../src/expander.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export type Fixture<T> = {
  name: string;
  input: T;
  expected: unknown;
};

function listFixtures(suite: string): { name: string; dir: string }[] {
  const root = path.join(here, "fixtures", suite);
  return readdirSync(root)
    .filter((n) => statSync(path.join(root, n)).isDirectory())
    .sort()
    .map((name) => ({ name, dir: path.join(root, name) }));
}

export function loadParserFixtures(): Fixture<string>[] {
  return listFixtures("parser").map(({ name, dir }) => ({
    name,
    input: readFileSync(path.join(dir, "input.css"), "utf8"),
    expected: JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")),
  }));
}

export function loadResolverFixtures(): Fixture<Recipe[]>[] {
  return listFixtures("resolver").map(({ name, dir }) => ({
    name,
    input: JSON.parse(readFileSync(path.join(dir, "input.json"), "utf8")) as Recipe[],
    expected: JSON.parse(readFileSync(path.join(dir, "expected.json"), "utf8")),
  }));
}

export type ExpanderFixture = {
  name: string;
  mode: ExpandMode;
  mergeConflicts: boolean;
  flattened: Record<string, string[]>;
  input: string;
  expected: string;
};

export function loadExpanderFixtures(): ExpanderFixture[] {
  return listFixtures("expander").map(({ name, dir }) => {
    const body = JSON.parse(readFileSync(path.join(dir, "fixture.json"), "utf8")) as Omit<
      ExpanderFixture,
      "name"
    >;
    return { name, ...body };
  });
}
