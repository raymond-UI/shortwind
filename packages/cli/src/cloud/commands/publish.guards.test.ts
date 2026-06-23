import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  InvalidSlugError,
  BundleTooLargeError,
  MAX_BUNDLE_FILES,
  readBundleDir,
  publishFromFile,
} from "./publish.js";

/**
 * CLI security hardening (#156) — the publish guards that run BEFORE any network:
 *   - client-side `--domain` slug validation (don't burn a round trip on a typo);
 *   - bundle-walk caps (file COUNT + total BYTES) and symlink SKIPPING (a symlink
 *     could escape the bundle dir or loop forever).
 */

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-bundle-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("publishFromFile — client-side slug validation (pre-network)", () => {
  it("rejects a malformed --domain before any network/home resolution", async () => {
    // A bad slug must throw InvalidSlugError synchronously in the assertion —
    // no client is supplied, so reaching the network would surface a different
    // error entirely.
    await expect(
      publishFromFile("nonexistent.html", { domain: "Not A Slug!" }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
  });

  it("rejects a reserved --domain slug locally", async () => {
    await expect(
      publishFromFile("nonexistent.html", { domain: "admin" }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
  });

  it("also validates the slug on the --bundle path before walking the dir", async () => {
    await expect(
      publishFromFile("nonexistent.html", { domain: "UPPER", bundle: true }),
    ).rejects.toBeInstanceOf(InvalidSlugError);
  });
});

describe("readBundleDir — symlink + cap guards", () => {
  it("collects plain .html files but SKIPS symlinks (does not follow them)", () => {
    writeFileSync(path.join(sandbox, "index.html"), "<p>home</p>");
    writeFileSync(path.join(sandbox, "about.html"), "<p>about</p>");
    // An outside target the symlink would otherwise pull in.
    const outside = mkdtempSync(path.join(tmpdir(), "sw-outside-"));
    writeFileSync(path.join(outside, "secret.html"), "<p>secret</p>");
    try {
      symlinkSync(path.join(outside, "secret.html"), path.join(sandbox, "link.html"));
      // A symlinked directory must not be recursed into either.
      symlinkSync(outside, path.join(sandbox, "linkdir"));
    } catch {
      // Some CI filesystems forbid symlinks; treat as covered-by-skip.
      return;
    }
    const { files } = readBundleDir(path.join(sandbox, "index.html"));
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["about.html", "index.html"]);
    expect(paths).not.toContain("link.html");
    expect(rmSync(outside, { recursive: true, force: true }));
  });

  it("throws BundleTooLargeError when the file COUNT cap is exceeded", () => {
    writeFileSync(path.join(sandbox, "index.html"), "<p>home</p>");
    for (let i = 0; i < MAX_BUNDLE_FILES + 5; i += 1) {
      writeFileSync(path.join(sandbox, `p${i}.html`), "<p>x</p>");
    }
    expect(() => readBundleDir(path.join(sandbox, "index.html"))).toThrow(
      BundleTooLargeError,
    );
  });

  it("throws BundleTooLargeError when the total BYTES cap is exceeded", () => {
    writeFileSync(path.join(sandbox, "index.html"), "<p>home</p>");
    // Two ~30 MB files blow past the 50 MB total cap without hitting the count cap.
    const big = "x".repeat(30 * 1024 * 1024);
    writeFileSync(path.join(sandbox, "a.html"), big);
    writeFileSync(path.join(sandbox, "b.html"), big);
    expect(() => readBundleDir(path.join(sandbox, "index.html"))).toThrow(
      BundleTooLargeError,
    );
  });

  it("accepts a small, symlink-free bundle", () => {
    writeFileSync(path.join(sandbox, "index.html"), "<p>home</p>");
    mkdirSync(path.join(sandbox, "docs"));
    writeFileSync(path.join(sandbox, "docs", "guide.html"), "<p>guide</p>");
    const { files, entryPath } = readBundleDir(path.join(sandbox, "index.html"));
    expect(entryPath).toBe("index.html");
    expect(files.map((f) => f.path).sort()).toEqual(["docs/guide.html", "index.html"]);
  });
});
