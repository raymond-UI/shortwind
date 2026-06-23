import { describe, expect, it } from "vitest";
import { renderDelete, runDelete, type Confirm } from "./delete.js";
import type { DeleteCapableClient } from "../api-client.js";

/** delete tests — confirm flow + endpoint call against a mocked api-client. */

function stubClient(onDelete: (id: string) => void): DeleteCapableClient {
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
    deletePage: async (id) => {
      onDelete(id);
    },
  };
}

const yes: Confirm = async () => true;
const no: Confirm = async () => false;

describe("renderDelete — golden output", () => {
  it("human: confirms or reports the abort", () => {
    expect(renderDelete("pg_1", true, false)).toBe("deleted pg_1");
    expect(renderDelete("pg_1", false, false)).toBe("aborted — pg_1 was not deleted");
  });

  it("--json: stable { id, deleted } shape", () => {
    expect(JSON.parse(renderDelete("pg_1", true, true))).toEqual({ id: "pg_1", deleted: true });
    expect(JSON.parse(renderDelete("pg_1", false, true))).toEqual({ id: "pg_1", deleted: false });
  });
});

describe("runDelete", () => {
  it("--yes skips confirmation and deletes the id", async () => {
    let deleted: string | undefined;
    const client = stubClient((id) => {
      deleted = id;
    });
    // A confirm that would FAIL the test if ever called — --yes must bypass it.
    const exploding: Confirm = async () => {
      throw new Error("confirm should not run with --yes");
    };
    const run = await runDelete(client, "pg_7", { yes: true }, exploding);
    expect(deleted).toBe("pg_7");
    expect(run.deleted).toBe(true);
    expect(run.output).toBe("deleted pg_7");
  });

  it("prompts when --yes is absent and deletes on confirm", async () => {
    let deleted: string | undefined;
    const client = stubClient((id) => {
      deleted = id;
    });
    const run = await runDelete(client, "pg_1", {}, yes);
    expect(deleted).toBe("pg_1");
    expect(run.deleted).toBe(true);
  });

  it("does NOT call deletePage when the user declines", async () => {
    let called = false;
    const client = stubClient(() => {
      called = true;
    });
    const run = await runDelete(client, "pg_1", {}, no);
    expect(called).toBe(false);
    expect(run.deleted).toBe(false);
    expect(run.output).toBe("aborted — pg_1 was not deleted");
  });

  it("honors --json on the confirmed path", async () => {
    const client = stubClient(() => {});
    const run = await runDelete(client, "pg_1", { yes: true, json: true }, yes);
    expect(JSON.parse(run.output)).toEqual({ id: "pg_1", deleted: true });
  });
});
