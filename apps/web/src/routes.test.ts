import { describe, expect, it } from "vitest";
import { routeTree } from "./routeTree.gen";
import { Route as IndexRoute } from "./routes/index";
import { Route as CatalogRoute } from "./routes/catalog";
import { Route as PlaygroundRoute } from "./routes/playground";
import { Route as DocsRoute } from "./routes/docs";
import { Route as DocsIndexRoute } from "./routes/docs.index";
import { Route as DocsSlugRoute } from "./routes/docs.$slug";

describe("apps/web routes", () => {
  it("generated route tree exists", () => {
    expect(routeTree).toBeDefined();
  });

  it("declares each placeholder route module", () => {
    for (const route of [
      IndexRoute,
      CatalogRoute,
      PlaygroundRoute,
      DocsRoute,
      DocsIndexRoute,
      DocsSlugRoute,
    ]) {
      expect(route).toBeDefined();
    }
  });
});
