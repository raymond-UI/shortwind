import { cac, type CAC } from "cac";
import { login } from "./commands/login.js";
import { initGlobal } from "./commands/init-global.js";
import { publish } from "./commands/publish.js";
import { update } from "./commands/update.js";
import { find } from "./commands/find.js";
import { get } from "./commands/get.js";
import { deletePage } from "./commands/delete.js";
import { visibility } from "./commands/visibility.js";
import { bindDomain } from "./commands/bind-domain.js";
import { reportStub, VERBS, type StubResult } from "./commands/stub.js";

/**
 * Shortwind Cloud CLI — `shortwind-cloud <verb>`.
 *
 * Mirrors `packages/cli/src/cli.ts`: build a cac program, register one command
 * per verb, then `parse(..., { run: false })` + `runMatchedCommand()` so an
 * async action's rejection flows back to the caller's catch instead of a raw
 * unhandled-rejection dump.
 *
 * CLOUD-04 ships every verb as a STUB: each parses its real PRD-§4 args/flags
 * and prints "not implemented", exiting cleanly. No network.
 */

// The `bin` name an end user types. The verbs (publish, find, …) are spoken
// as subcommands: `shortwind-cloud publish ./page.html`.
const BIN = "shortwind-cloud";

/**
 * Build the cac program with every verb registered. Each action runs the pure
 * stub handler and reports the result. Exported (separately from {@link run})
 * so tests can assert the registered verbs without parsing argv.
 */
export function buildCli(onStub: (result: StubResult) => void = reportStub): CAC {
  const cli = cac(BIN);

  cli
    .command("login", "Authenticate via the OAuth device flow and store a token")
    .option("--scope <scope>", "Request a scope (repeatable; e.g. domains:bind for step-up)")
    .option("--endpoint <url>", "Cloud API origin")
    .action((opts: { scope?: string | string[]; endpoint?: string }) => {
      onStub(login(opts));
    });

  cli
    .command("init-global", "Write the global Cloud config (endpoint + credentials)")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--force", "Overwrite an existing global config")
    .action((opts: { endpoint?: string; force?: boolean }) => {
      onStub(initGlobal(opts));
    });

  cli
    .command("publish <file>", "Create a page from an HTML file (POST /v1/pages)")
    .option("--domain <slug>", "Desired subdomain/slug")
    .option("--tag <tag>", "Attach a tag (repeatable)")
    .option("--visibility <level>", "public | unlisted | private")
    .option("--idempotency-key <key>", "Idempotency key for safe retries")
    .option("--json", "Emit machine-readable JSON")
    .action(
      (
        file: string,
        opts: {
          domain?: string;
          tag?: string | string[];
          visibility?: string;
          idempotencyKey?: string;
          json?: boolean;
        },
      ) => {
        onStub(publish(file, opts));
      },
    );

  cli
    .command("update <id> <file>", "Republish HTML to the same URL (PATCH /v1/pages/{id})")
    .option("--idempotency-key <key>", "Idempotency key for safe retries")
    .option("--json", "Emit machine-readable JSON")
    .action((id: string, file: string, opts: { idempotencyKey?: string; json?: boolean }) => {
      onStub(update(id, file, opts));
    });

  cli
    .command("find", "Locate existing pages (GET /v1/pages?q=&domain=&tag=)")
    .option("--q <query>", "Free-text query")
    .option("--domain <domain>", "Filter by bound domain")
    .option("--tag <tag>", "Filter by tag (repeatable)")
    .option("--json", "Emit machine-readable JSON")
    .action((opts: { q?: string; domain?: string; tag?: string | string[]; json?: boolean }) => {
      onStub(find(opts));
    });

  cli
    .command("get <id>", "Fetch page metadata + version list (GET /v1/pages/{id})")
    .option("--json", "Emit machine-readable JSON")
    .action((id: string, opts: { json?: boolean }) => {
      onStub(get(id, opts));
    });

  cli
    .command("delete <id>", "Remove a page (DELETE /v1/pages/{id} — tombstone)")
    .option("-y, --yes", "Skip the confirmation prompt")
    .option("--json", "Emit machine-readable JSON")
    .action((id: string, opts: { yes?: boolean; json?: boolean }) => {
      onStub(deletePage(id, opts));
    });

  cli
    .command("visibility <id> <level>", "Set page visibility: public | unlisted | private")
    .option("--json", "Emit machine-readable JSON")
    .action((id: string, level: string, opts: { json?: boolean }) => {
      onStub(visibility(id, level, opts));
    });

  cli
    .command(
      "bind-domain <id> <hostname>",
      "Bind a custom hostname (POST /v1/pages/{id}/domain — requires domains:bind)",
    )
    .option("--json", "Emit machine-readable JSON")
    .action((id: string, hostname: string, opts: { json?: boolean }) => {
      onStub(bindDomain(id, hostname, opts));
    });

  cli.help();
  cli.version("0.0.0");
  return cli;
}

/**
 * The set of verbs registered on a cac program — used by tests and by the
 * top-level `--help` sanity check. Derived from the canonical {@link VERBS}
 * list so the two never drift.
 */
export function registeredVerbs(cli: CAC): string[] {
  return cli.commands
    .map((c) => c.name.split(" ")[0])
    .filter((name): name is string => Boolean(name));
}

export { VERBS };

export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = buildCli();
  // cac's parse() invokes the matched action but does NOT await it; parse
  // without running, then await the matched command so an async rejection
  // flows back to bin.ts's `run().catch` instead of escaping as an unhandled
  // rejection (same idiom as packages/cli).
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}
