import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export type Fixture = {
  name: string;
  input: string;
  expected: unknown;
};

export function loadFixtures(suite: string): Fixture[] {
  const dir = path.join(here, "fixtures", suite);
  const entries = readdirSync(dir)
    .filter((n) => statSync(path.join(dir, n)).isDirectory())
    .sort();

  return entries.map((name) => {
    const inputPath = path.join(dir, name, "input.css");
    const expectedPath = path.join(dir, name, "expected.json");
    return {
      name,
      input: readFileSync(inputPath, "utf8"),
      expected: JSON.parse(readFileSync(expectedPath, "utf8")),
    };
  });
}
