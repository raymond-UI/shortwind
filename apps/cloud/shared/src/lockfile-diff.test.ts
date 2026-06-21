import { describe, expect, it } from "vitest";
import { diffLockfiles, type Lockfile } from "./lockfile-diff.js";

// Golden fixtures: each case is `(incoming, stored) -> { added, changed, removed }`.
// The shape mirrors packages/cli/src/lockfile.ts exactly (version/registry/families
// with { version, sha } entries), so a cloud publish can diff a CLI-written
// `.shortwind-lock.json` byte-for-byte the way the CLI itself would.

function lock(families: Lockfile["families"]): Lockfile {
  return { version: 1, registry: "https://catalog.shortwind.dev", families };
}

describe("diffLockfiles (CLOUD-03 golden)", () => {
  it("reports nothing when the lockfiles are identical", () => {
    const l = lock({ card: { version: "0.4.0", sha: "aaaa" }, button: { version: "0.1.0", sha: "bbbb" } });
    expect(diffLockfiles(l, l)).toEqual({ added: [], changed: [], removed: [] });
  });

  it("classifies a brand-new family as added", () => {
    const stored = lock({ card: { version: "0.4.0", sha: "aaaa" } });
    const incoming = lock({
      card: { version: "0.4.0", sha: "aaaa" },
      button: { version: "0.1.0", sha: "bbbb" },
    });
    expect(diffLockfiles(incoming, stored)).toEqual({
      added: [{ family: "button", version: "0.1.0", sha: "bbbb" }],
      changed: [],
      removed: [],
    });
  });

  it("classifies a family whose sha diverges as changed (carrying before/after)", () => {
    const stored = lock({ card: { version: "0.4.0", sha: "aaaa" } });
    const incoming = lock({ card: { version: "0.5.0", sha: "cccc" } });
    expect(diffLockfiles(incoming, stored)).toEqual({
      added: [],
      changed: [
        {
          family: "card",
          from: { version: "0.4.0", sha: "aaaa" },
          to: { version: "0.5.0", sha: "cccc" },
        },
      ],
      removed: [],
    });
  });

  it("treats a version bump with the SAME sha as changed (version is part of identity)", () => {
    const stored = lock({ card: { version: "0.4.0", sha: "aaaa" } });
    const incoming = lock({ card: { version: "0.4.1", sha: "aaaa" } });
    const diff = diffLockfiles(incoming, stored);
    expect(diff.changed).toEqual([
      {
        family: "card",
        from: { version: "0.4.0", sha: "aaaa" },
        to: { version: "0.4.1", sha: "aaaa" },
      },
    ]);
  });

  it("classifies a family present only in stored as removed", () => {
    const stored = lock({
      card: { version: "0.4.0", sha: "aaaa" },
      legacy: { version: "0.0.1", sha: "dead" },
    });
    const incoming = lock({ card: { version: "0.4.0", sha: "aaaa" } });
    expect(diffLockfiles(incoming, stored)).toEqual({
      added: [],
      changed: [],
      removed: [{ family: "legacy", version: "0.0.1", sha: "dead" }],
    });
  });

  it("handles added + changed + removed together, each list sorted by family", () => {
    const stored = lock({
      card: { version: "0.4.0", sha: "aaaa" },
      modal: { version: "0.2.0", sha: "mmmm" },
      legacy: { version: "0.0.1", sha: "dead" },
    });
    const incoming = lock({
      card: { version: "0.5.0", sha: "cccc" }, // changed
      modal: { version: "0.2.0", sha: "mmmm" }, // unchanged
      button: { version: "0.1.0", sha: "bbbb" }, // added
      alert: { version: "0.3.0", sha: "eeee" }, // added
      // legacy removed
    });
    expect(diffLockfiles(incoming, stored)).toEqual({
      added: [
        { family: "alert", version: "0.3.0", sha: "eeee" },
        { family: "button", version: "0.1.0", sha: "bbbb" },
      ],
      changed: [
        {
          family: "card",
          from: { version: "0.4.0", sha: "aaaa" },
          to: { version: "0.5.0", sha: "cccc" },
        },
      ],
      removed: [{ family: "legacy", version: "0.0.1", sha: "dead" }],
    });
  });

  it("tolerates missing/empty families objects on either side", () => {
    const empty: Lockfile = { version: 1, registry: "", families: {} };
    const incoming = lock({ card: { version: "0.1.0", sha: "aaaa" } });
    expect(diffLockfiles(incoming, empty)).toEqual({
      added: [{ family: "card", version: "0.1.0", sha: "aaaa" }],
      changed: [],
      removed: [],
    });
    expect(diffLockfiles(empty, incoming)).toEqual({
      added: [],
      changed: [],
      removed: [{ family: "card", version: "0.1.0", sha: "aaaa" }],
    });
  });
});
