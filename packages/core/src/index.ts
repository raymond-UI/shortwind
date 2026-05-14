export { parseRecipeFile } from "./parser.js";
export { buildRegistry } from "./resolver.js";
export { expand, expandClassList, expandDOM } from "./expander.js";
export type { ExpandMode, ExpandOptions } from "./expander.js";
export type {
  Diagnostic,
  ParsedRecipeFile,
  Recipe,
  RecipeFileHeader,
  Registry,
  Result,
} from "./types.js";
