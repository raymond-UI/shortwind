// Types for the bundle-clean registry module the shortwind integration serves.
// Add to your project's src/env.d.ts:
//   /// <reference types="@shortwind/astro/client" />
declare module "virtual:shortwind/registry" {
  const registry: import("@shortwind/vite").Registry;
  export default registry;
}
