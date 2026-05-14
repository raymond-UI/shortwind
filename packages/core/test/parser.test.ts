import { describe, it, expect } from "vitest";
import { parseRecipeFile } from "../src/parser.js";
import { loadParserFixtures } from "./run-fixtures.js";

describe("parseRecipeFile (fixtures)", () => {
  for (const fx of loadParserFixtures()) {
    it(fx.name, () => {
      const result = parseRecipeFile(fx.input, "input.css");
      expect(result).toEqual(fx.expected);
    });
  }
});
