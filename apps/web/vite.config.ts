import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { shortwind } from "@shortwind/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const recipesDir = path.resolve(here, "../../packages/registry/recipes");

export default defineConfig({
  plugins: [
    // Shortwind must run before Tailwind so the scanner sees expanded utility
    // classes instead of the literal `@recipe` tokens we author in JSX.
    ...shortwind({ recipesDir }),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  server: {
    port: 5173,
  },
});
