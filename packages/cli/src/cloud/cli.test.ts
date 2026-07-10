import { describe, expect, it } from "vitest";
import { buildCli, registeredVerbs, VERBS } from "./cli.js";
import { type StubResult } from "./commands/stub.js";

/**
 * Drive the cac program the way `run()` does, but capture the stub result
 * instead of writing to stderr — pure parse assertions, no network (CLOUD-04
 * acceptance).
 */
function parse(argv: string[]): StubResult {
  let captured: StubResult | undefined;
  const cli = buildCli((r) => {
    captured = r;
  });
  // Mimic cli.run(): parse without auto-running, then run the matched command.
  cli.parse(["node", "shortwind-cloud", ...argv], { run: false });
  cli.runMatchedCommand();
  if (!captured) throw new Error(`no command matched: ${argv.join(" ")}`);
  return captured;
}

describe("command registration", () => {
  it("registers all nine PRD §4 verbs", () => {
    const verbs = registeredVerbs(buildCli());
    for (const verb of VERBS) {
      expect(verbs).toContain(verb);
    }
  });

  it("registers exactly the nine verbs (no stray commands)", () => {
    // cac adds a default "" command for the bare invocation; ignore it.
    const verbs = registeredVerbs(buildCli()).filter((v) => v.length > 0);
    expect(new Set(verbs)).toEqual(new Set(VERBS));
  });
});

describe("argument parsing", () => {
  // login + init-global are now real handlers (CLOUD-11), not stubs — their own
  // command tests cover behavior. Here they only need to register (asserted in
  // "command registration") and stay off the stub path.
  it("publish parses file, tags, domain, visibility, idempotency", () => {
    const r = parse([
      "publish",
      "./page.html",
      "--domain",
      "status",
      "--tag",
      "a",
      "--tag",
      "b",
      "--visibility",
      "unlisted",
      "--idempotency-key",
      "key-1",
    ]);
    expect(r.verb).toBe("publish");
    expect(r.parsed.file).toBe("./page.html");
    expect(r.parsed.domain).toBe("status");
    expect(r.parsed.tags).toEqual(["a", "b"]);
    expect(r.parsed.visibility).toBe("unlisted");
    expect(r.parsed.idempotencyKey).toBe("key-1");
    // --bundle absent → single-file publish.
    expect(r.parsed.bundle).toBe(false);
  });

  it("publish --bundle marks a multi-page bundle deploy", () => {
    const r = parse(["publish", "./site/index.html", "--bundle"]);
    expect(r.verb).toBe("publish");
    expect(r.parsed.file).toBe("./site/index.html");
    expect(r.parsed.bundle).toBe(true);
  });

  it("update parses id and file positionals", () => {
    const r = parse(["update", "pg_abc", "./page.html"]);
    expect(r.verb).toBe("update");
    expect(r.parsed.id).toBe("pg_abc");
    expect(r.parsed.file).toBe("./page.html");
  });

  it("find parses query and repeatable tags", () => {
    const r = parse(["find", "--q", "status", "--tag", "ops"]);
    expect(r.verb).toBe("find");
    expect(r.parsed.q).toBe("status");
    expect(r.parsed.tags).toEqual(["ops"]);
  });

  it("get parses id and --json", () => {
    const r = parse(["get", "pg_abc", "--json"]);
    expect(r.verb).toBe("get");
    expect(r.parsed.id).toBe("pg_abc");
    expect(r.parsed.json).toBe(true);
  });

  it("delete parses id and --yes", () => {
    const r = parse(["delete", "pg_abc", "--yes"]);
    expect(r.verb).toBe("delete");
    expect(r.parsed.id).toBe("pg_abc");
    expect(r.parsed.yes).toBe(true);
  });

  it("visibility parses id, level, and flags invalid levels", () => {
    const ok = parse(["visibility", "pg_abc", "private"]);
    expect(ok.parsed.level).toBe("private");
    expect(ok.parsed.validLevel).toBe(true);

    const bad = parse(["visibility", "pg_abc", "secret"]);
    expect(bad.parsed.validLevel).toBe(false);
  });

  it("bind-domain parses the account hostname", () => {
    const r = parse(["bind-domain", "status.acme.com"]);
    expect(r.verb).toBe("bind-domain");
    expect(r.parsed.hostname).toBe("status.acme.com");
  });

  it("every still-stubbed verb resolves to a stub tagged with a CLOUD issue", () => {
    // login + init-global are real (CLOUD-11) and no longer route through the
    // stub reporter; the remaining seven verbs are stubs pending their waves.
    const samples: Record<string, string[]> = {
      publish: ["publish", "./p.html"],
      update: ["update", "pg_1", "./p.html"],
      find: ["find"],
      get: ["get", "pg_1"],
      delete: ["delete", "pg_1"],
      visibility: ["visibility", "pg_1", "public"],
      "bind-domain": ["bind-domain", "h.example.com"],
    };
    for (const argv of Object.values(samples)) {
      const r = parse(argv);
      expect(r.implementedBy).toMatch(/^CLOUD-\d+$/);
    }
  });
});
