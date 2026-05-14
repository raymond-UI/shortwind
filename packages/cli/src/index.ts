export { init, DEFAULT_REGISTRY } from "./init.js";
export type { InitOptions, InitResult, InstallPackages } from "./init.js";
export { detectProject } from "./detect.js";
export type { PackageManager, Bundler, Framework, ProjectShape } from "./detect.js";
export { createRegistrySource, resolvePresetFamilies } from "./registry-source.js";
export type { RegistrySource, Presets } from "./registry-source.js";
