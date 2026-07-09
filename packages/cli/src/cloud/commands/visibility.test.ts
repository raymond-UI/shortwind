import { describe, expect, it } from "vitest";
import {
  isVisibilityLevel,
  renderVisibility,
  runVisibility,
  InvalidVisibilityError,
  VISIBILITY_LEVELS,
} from "./visibility.js";
import type { PageSummary, VisibilityCapableClient } from "../api-client.js";

/** visibility tests — level validation + endpoint call against a mock client. */

const SUMMARY: PageSummary = {
  id: "pg_1",
  slug: "status",
  url: "https://shortwind.dev/status",
  visibility: "private",
  currentVersion: 2,
  tags: ["ops"],
  updatedAt: 1717000000000,
};

function stubClient(
  onSet: (id: string, level: string) => void,
): VisibilityCapableClient {
  return {
    findPages: async () => ({ pages: [] }),
    getPage: async () => {
      throw new Error("unused");
    },
    publishPage: async () => {
      throw new Error("unused");
    },
    updatePage: async () => {
      throw new Error("unused");
    },
    setVisibility: async (id, level) => {
      onSet(id, level);
      return { ...SUMMARY, visibility: level };
    },
  };
}

describe("isVisibilityLevel", () => {
  it("accepts the three known levels and rejects others", () => {
    expect(VISIBILITY_LEVELS).toEqual(["public", "unlisted", "private"]);
    for (const lvl of VISIBILITY_LEVELS) expect(isVisibilityLevel(lvl)).toBe(true);
    expect(isVisibilityLevel("secret")).toBe(false);
    expect(isVisibilityLevel("PUBLIC")).toBe(false);
  });
});

describe("renderVisibility — golden output", () => {
  it("human: confirms the new level on the URL", () => {
    expect(renderVisibility(SUMMARY, false)).toBe(
      "set pg_1 → private (https://shortwind.dev/status)",
    );
  });

  it("--json: emits the updated summary verbatim", () => {
    expect(JSON.parse(renderVisibility(SUMMARY, true))).toEqual(SUMMARY);
  });
});

describe("runVisibility", () => {
  it("validates the level, calls setVisibility, and renders the result", async () => {
    let seen: { id?: string; level?: string } = {};
    const client = stubClient((id, level) => {
      seen = { id, level };
    });
    const out = await runVisibility(client, "pg_1", "unlisted", {});
    expect(seen).toEqual({ id: "pg_1", level: "unlisted" });
    expect(out).toBe("set pg_1 → unlisted (https://shortwind.dev/status)");
  });

  it("throws InvalidVisibilityError on a bad level and never calls the client", async () => {
    let called = false;
    const client = stubClient(() => {
      called = true;
    });
    await expect(runVisibility(client, "pg_1", "secret", {})).rejects.toBeInstanceOf(
      InvalidVisibilityError,
    );
    expect(called).toBe(false);
  });
});
