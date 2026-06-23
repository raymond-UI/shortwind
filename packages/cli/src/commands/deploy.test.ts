import { describe, expect, it } from "vitest";
import { runDeploy, NotLoggedInError, type DeployDeps } from "./deploy.js";
import { BuildError, type BuildResult } from "./build.js";
import type { PublishRun } from "../cloud/commands/publish.js";

// runDeploy is the build→publish golden path. These tests inject fake build +
// publish so the orchestration is verified with no fs/network.

const okPublish: PublishRun = {
  ok: true,
  output: "published https://demo.shortwind.app",
  id: "pg_1",
};

function deps(over: Partial<DeployDeps> = {}): DeployDeps {
  return {
    // Injected so the suite never reads the real ~/.shortwind credentials.
    isLoggedIn: () => true,
    recipesDirExists: () => true,
    build: async (): Promise<BuildResult> => ({
      changed: true,
      families: ["card", "btn"],
      skillPath: "skills/shortwind/SKILL.md",
      safelistCssPaths: [],
    }),
    publish: async () => okPublish,
    ...over,
  };
}

describe("runDeploy", () => {
  it("builds then publishes when a recipes dir exists", async () => {
    let order = "";
    const run = await runDeploy(
      "page.html",
      { cwd: "/proj" },
      deps({
        build: async () => {
          order += "build,";
          return { changed: true, families: ["card", "btn"], skillPath: "x", safelistCssPaths: [] };
        },
        publish: async () => {
          order += "publish";
          return okPublish;
        },
      }),
    );
    expect(order).toBe("build,publish");
    expect(run.buildSummary).toBe("built 2 recipe families");
    expect(run.publish.output).toContain("shortwind.app");
  });

  it("reports 'up to date' when the build made no changes", async () => {
    const run = await runDeploy(
      "page.html",
      { cwd: "/proj" },
      deps({
        build: async () => ({ changed: false, families: ["card"], skillPath: "x", safelistCssPaths: [] }),
      }),
    );
    expect(run.buildSummary).toBe("recipes up to date (1 family)");
  });

  it("skips the build when the project has no recipes dir", async () => {
    let built = false;
    const run = await runDeploy(
      "page.html",
      { cwd: "/proj" },
      deps({
        recipesDirExists: () => false,
        build: async () => {
          built = true;
          return { changed: true, families: [], skillPath: "x", safelistCssPaths: [] };
        },
      }),
    );
    expect(built).toBe(false);
    expect(run.buildSummary).toBeNull();
    expect(run.publish.ok).toBe(true);
  });

  it("skips the build when --no-build is passed (opts.build === false)", async () => {
    let built = false;
    const run = await runDeploy(
      "page.html",
      { cwd: "/proj", build: false },
      deps({
        build: async () => {
          built = true;
          return { changed: true, families: ["card"], skillPath: "x", safelistCssPaths: [] };
        },
      }),
    );
    expect(built).toBe(false);
    expect(run.buildSummary).toBeNull();
  });

  it("surfaces a publish conflict as a non-ok run (no throw)", async () => {
    const conflict: PublishRun = {
      ok: false,
      output: "a page with this handle already exists (id: pg_dup)\nrun: shortwind cloud update pg_dup <file>",
      id: "pg_dup",
    };
    const run = await runDeploy("page.html", { cwd: "/proj" }, deps({ publish: async () => conflict }));
    expect(run.publish.ok).toBe(false);
    expect(run.publish.output).toContain("shortwind cloud update");
  });

  it("fails fast with NotLoggedInError before building or publishing", async () => {
    let built = false;
    let published = false;
    await expect(
      runDeploy(
        "page.html",
        { cwd: "/proj" },
        deps({
          isLoggedIn: () => false,
          build: async () => {
            built = true;
            return { changed: true, families: ["card"], skillPath: "x", safelistCssPaths: [] };
          },
          publish: async () => {
            published = true;
            return okPublish;
          },
        }),
      ),
    ).rejects.toBeInstanceOf(NotLoggedInError);
    expect(built).toBe(false);
    expect(published).toBe(false);
  });

  it("propagates a BuildError (invalid recipes must not ship)", async () => {
    let published = false;
    await expect(
      runDeploy(
        "page.html",
        { cwd: "/proj" },
        deps({
          build: async () => {
            throw new BuildError([
              { file: "card.css", line: 1, code: "E", message: "boom" } as never,
            ]);
          },
          publish: async () => {
            published = true;
            return okPublish;
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BuildError);
    expect(published).toBe(false);
  });
});
