import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Docs are local markdown under src/content/docs. Frontmatter mirrors what the
// old site used: title, optional description, and an `order` for the sidebar.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(999),
  }),
});

export const collections = { docs };
