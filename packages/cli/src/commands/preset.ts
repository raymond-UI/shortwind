import path from "node:path";
import { resolveSource, resolvePresetFamilies } from "../registry-source.js";
import { readConfig } from "../project.js";
import { add, type AddResult } from "./add.js";

export type PresetOptions = {
  cwd: string;
  name: string;
  registry?: string;
};

export type PresetResult = AddResult & { preset: string };

export async function preset(options: PresetOptions): Promise<PresetResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const registry = options.registry ?? config.registry;
  const source = resolveSource(registry);

  if (options.name === "none") {
    throw new Error("Use `shortwind remove` to uninstall families; preset 'none' is for `init` only.");
  }

  const presets = await source.loadPresets();
  const all = await source.listAllFamilies();
  const families = resolvePresetFamilies(options.name, presets, all);

  const addOptions: Parameters<typeof add>[0] = {
    cwd,
    families,
  };
  if (options.registry !== undefined) addOptions.registry = options.registry;

  const result = await add(addOptions);
  return { ...result, preset: options.name };
}
