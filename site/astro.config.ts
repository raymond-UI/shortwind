import { defineConfig } from "astro/config";
import type { AstroIntegration } from "astro";
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
    //
    // Cast: the pinned @shortwind/astro builds its integration object against
    // its own minimal structural types, which aren't assignable to this astro
    // version's AstroIntegration under strict function contravariance (the
    // runtime shape is correct). @shortwind/astro@>0.1.0-beta.9 widens the type
    // so this cast can drop once the site bumps to it.
    shortwind() as unknown as AstroIntegration,
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
