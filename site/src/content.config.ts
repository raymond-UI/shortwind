import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Docs are local markdown under src/content/docs. Frontmatter mirrors what the
// old site used: title, optional description, and an `order` for the sidebar.
//
// `product` splits the docs into two independent trees behind the sidebar's
// Core/Cloud switcher: "core" is the local build-time class layer (the default,
// so the existing pages need no frontmatter change); "cloud" is the hosted
// product. `order` is scoped per product, so each tree numbers from 0.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(999),
    product: z.enum(["core", "cloud"]).default("core"),
  }),
});

export const collections = { docs };
