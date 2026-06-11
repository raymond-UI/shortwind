import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import shortwind from "@shortwind/astro";

// Static docs/marketing site. Every data source is build-time-known (local
// markdown, recipes parsed at build, in-browser expand() in the playground),
// so there is no SSR — `astro build` emits a plain dist/ of HTML/CSS/JS.
export default defineConfig({
  output: "static",
  site: "https://shortwind.dev",
  integrations: [
    // Powers the two interactive islands: Catalog.tsx and Playground.tsx.
    react(),
    // Expands @recipe tokens in .astro/.tsx/.md before Tailwind's content scan.
    // recipesDir defaults to <root>/recipes — exactly where `shortwind init`
    // scaffolded the catalog we now own.
    shortwind(),
  ],
  vite: {
    // Tailwind v4. Shortwind's plugins are enforce:"pre", so they run ahead of
    // this regardless of array position.
    plugins: [tailwindcss()],
  },
  markdown: {
    // Dual-theme code fences. Light is applied inline (defaultColor); the
    // .dark override in index.css flips to the dark theme's CSS vars so docs
    // code blocks follow the site theme.
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: false,
    },
  },
});
