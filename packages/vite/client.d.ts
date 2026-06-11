// Types for the bundle-clean registry module the shortwind() plugin serves.
// Add to your project's vite-env.d.ts:
//   /// <reference types="@shortwind/vite/client" />
declare module "virtual:shortwind/registry" {
  const registry: import("@shortwind/core").Registry;
  export default registry;
}
