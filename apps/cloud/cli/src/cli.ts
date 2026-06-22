import { cac, type CAC } from "cac";
import { login } from "./commands/login.js";
import { initGlobal } from "./commands/init-global.js";
import {
  publish,
  publishFromFile,
  InvalidSlugError,
  BundleTooLargeError,
} from "./commands/publish.js";
import { update, updateFromFile } from "./commands/update.js";
import { find, runFind } from "./commands/find.js";
import { get, runGet } from "./commands/get.js";
import { deletePage, runDelete, type Confirm } from "./commands/delete.js";
import { visibility, runVisibility, InvalidVisibilityError } from "./commands/visibility.js";
import {
  bindDomain,
  runBindDomain,
  StepUpDeniedError,
  InvalidHostnameError,
  BIND_SCOPE,
  type StepUpOutcome,
} from "./commands/bind-domain.js";
import { runSkill } from "./commands/skill.js";
import {
  ApiError,
  createApiClient,
  resolveBaseUrl,
  type DeleteCapableClient,
  type VisibilityCapableClient,
  type DomainCapableClient,
} from "./api-client.js";
import { resolveHome, readActiveAccount } from "./home.js";
import { reportStub, VERBS, type StubResult } from "./commands/stub.js";

/**
 * Shortwind Cloud CLI — `shortwind-cloud <verb>`.
 *
 * Mirrors `packages/cli/src/cli.ts`: build a cac program, register one command
 * per verb, then `parse(..., { run: false })` + `runMatchedCommand()` so an
 * async action's rejection flows back to the caller's catch instead of a raw
 * unhandled-rejection dump.
 *
 * Wiring history:
 *   - CLOUD-04 shipped every verb as a parse STUB (args/flags only, no IO).
 *   - CLOUD-11 made `login` / `init-global` REAL.
 *   - CLOUD-30a wires the four page verbs (`publish` / `update` / `find` /
 *     `get`) to their REAL, unit-tested handlers (`publishFromFile`,
 *     `updateFromFile`, `runFind`, `runGet`) via the REST api-client.
 *
 * `buildCli()` still builds the PARSE-ONLY program (the four page verbs route
 * through the injected `onStub` reporter) so the parse-shape tests in
 * `cli.test.ts` stay byte-stable. The production entrypoint `run()` builds the
 * REAL program via {@link buildRealCli}, which calls the actual handlers.
 */

// The `bin` name an end user types. The verbs (publish, find, …) are spoken
// as subcommands: `shortwind-cloud publish ./page.html`.
const BIN = "shortwind-cloud";

/**
 * Build the cac program with every verb registered. Each action runs the pure
 * stub handler and reports the result. Exported (separately from {@link run})
 * so tests can assert the registered verbs without parsing argv.
 */
/**
 * Register the REAL `login` + `init-global` verbs (CLOUD-11). Shared by both the
 * parse-only {@link buildCli} and the production {@link buildRealCli}: these two
 * have owned real handlers since CLOUD-11 and never routed through the stub
 * reporter.
 */
function registerAuthVerbs(cli: CAC): void {
  cli
    .command("login", "Authenticate via the OAuth device flow and store a token")
    .option("--scope <scope>", "Request a scope (repeatable; e.g. domains:bind for step-up)")
    .option("--endpoint <url>", "Cloud API origin")
    .action(async (opts: { scope?: string | string[]; endpoint?: string }) => {
      const result = await login(opts);
      if (result.ok) {
        process.stderr.write(
          `logged in as ${result.account.label} (active account: ${result.account.id})\n`,
        );
      } else {
        process.stderr.write(`login ${result.reason}\n`);
        process.exitCode = 1;
      }
    });

  cli
    .command("init-global", "Create the global Shortwind home (~/.shortwind/)")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--force", "Overwrite an existing global home")
    .action(async (opts: { endpoint?: string; force?: boolean }) => {
      const result = await initGlobal(opts);
      process.stderr.write(
        `${result.created ? "created" : "already initialized"} Shortwind home at ${result.home}\n`,
      );
    });
}

export function buildCli(onStub: (result: StubResult) => void = reportStub): CAC {
  const cli = cac(BIN);

  registerAuthVerbs(cli);

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

/**
 * Translate an {@link ApiError} into a single actionable stderr line + a
 * non-zero exit code. Keeps the four page verbs' failure surface uniform: the
 * 401/403/404 the REST edge returns become a human reason, not a stack dump.
 * Non-ApiErrors (e.g. "not logged in", missing file) re-throw to `run().catch`.
 */
function reportApiError(err: unknown): void {
  if (err instanceof ApiError) {
    process.stderr.write(`error: ${err.message} (${err.kind})\n`);
    process.exitCode = 1;
    return;
  }
  // Client-side validation / resource-guard failures (bad --domain slug, an
  // over-cap bundle) are expected, actionable errors — a clean line + exit 1,
  // not a re-thrown stack to bin.ts.
  if (err instanceof InvalidSlugError || err instanceof BundleTooLargeError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  throw err;
}

/**
 * Build the PRODUCTION cac program: the four page verbs (`publish` / `update` /
 * `find` / `get`) call their REAL handlers through the REST api-client, instead
 * of the parse stubs. `delete` / `visibility` / `bind-domain` remain stubs until
 * their own waves. The base URL is resolved from `SHORTWIND_CLOUD_API` (or the
 * default) inside each handler's `*FromFile` shell; `--endpoint` is honored where
 * the handler accepts a `baseUrl`.
 */
export function buildRealCli(): CAC {
  const cli = cac(BIN);

  registerAuthVerbs(cli);

  cli
    .command("publish <file>", "Create a page from an HTML file (POST /v1/pages)")
    .option("--domain <slug>", "Desired subdomain/slug")
    .option("--tag <tag>", "Attach a tag (repeatable)")
    .option("--visibility <level>", "public | unlisted | private")
    .option("--idempotency-key <key>", "Idempotency key for safe retries")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(
      async (
        file: string,
        opts: {
          domain?: string;
          tag?: string | string[];
          visibility?: string;
          idempotencyKey?: string;
          endpoint?: string;
          json?: boolean;
        },
      ) => {
        try {
          const run = await publishFromFile(file, opts, {
            baseUrl: resolveBaseUrl(opts.endpoint),
          });
          process.stdout.write(run.output + "\n");
          if (!run.ok) process.exitCode = 1;
        } catch (err) {
          reportApiError(err);
        }
      },
    );

  cli
    .command("update <id> <file>", "Republish HTML to the same URL (PATCH /v1/pages/{id})")
    .option("--idempotency-key <key>", "Idempotency key for safe retries")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(
      async (
        id: string,
        file: string,
        opts: { idempotencyKey?: string; endpoint?: string; json?: boolean },
      ) => {
        try {
          const { output } = await updateFromFile(id, file, opts, {
            baseUrl: resolveBaseUrl(opts.endpoint),
          });
          process.stdout.write(output + "\n");
        } catch (err) {
          reportApiError(err);
        }
      },
    );

  cli
    .command("find", "Locate existing pages (GET /v1/pages?q=&domain=&tag=)")
    .option("--q <query>", "Free-text query")
    .option("--domain <domain>", "Filter by bound domain")
    .option("--tag <tag>", "Filter by tag (repeatable)")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(
      async (opts: {
        q?: string;
        domain?: string;
        tag?: string | string[];
        endpoint?: string;
        json?: boolean;
      }) => {
        try {
          const output = await runFind(makeClient(opts.endpoint), opts);
          process.stdout.write(output + "\n");
        } catch (err) {
          reportApiError(err);
        }
      },
    );

  cli
    .command("get <id>", "Fetch page metadata + version list (GET /v1/pages/{id})")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(async (id: string, opts: { endpoint?: string; json?: boolean }) => {
      try {
        const output = await runGet(makeClient(opts.endpoint), id, opts);
        process.stdout.write(output + "\n");
      } catch (err) {
        reportApiError(err);
      }
    });

  cli
    .command("delete <id>", "Remove a page (DELETE /v1/pages/{id} — tombstone)")
    .option("-y, --yes", "Skip the confirmation prompt")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(async (id: string, opts: { yes?: boolean; endpoint?: string; json?: boolean }) => {
      try {
        const client = makeClient(opts.endpoint) as DeleteCapableClient;
        const run = await runDelete(client, id, opts, stdinConfirm);
        process.stdout.write(run.output + "\n");
        if (!run.deleted) process.exitCode = 1;
      } catch (err) {
        reportApiError(err);
      }
    });

  cli
    .command("visibility <id> <level>", "Set page visibility: public | unlisted | private")
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(async (id: string, level: string, opts: { endpoint?: string; json?: boolean }) => {
      try {
        const client = makeClient(opts.endpoint) as VisibilityCapableClient;
        const output = await runVisibility(client, id, level, opts);
        process.stdout.write(output + "\n");
      } catch (err) {
        if (err instanceof InvalidVisibilityError) {
          process.stderr.write(`error: ${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        reportApiError(err);
      }
    });

  cli
    .command(
      "bind-domain <id> <hostname>",
      "Bind a custom hostname (POST /v1/pages/{id}/domain — requires domains:bind)",
    )
    .option("--endpoint <url>", "Cloud API origin")
    .option("--json", "Emit machine-readable JSON")
    .action(async (id: string, hostname: string, opts: { endpoint?: string; json?: boolean }) => {
      try {
        const client = makeClient(opts.endpoint) as DomainCapableClient;
        const output = await runBindDomain(id, hostname, opts, {
          client,
          readScopes: () => activeScopes(),
          stepUp: () => stepUpBindScope(opts.endpoint),
        });
        process.stdout.write(output + "\n");
      } catch (err) {
        if (err instanceof StepUpDeniedError || err instanceof InvalidHostnameError) {
          process.stderr.write(`error: ${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        reportApiError(err);
      }
    });

  cli
    .command("skill", "Emit the cloud SKILL.md (verbs + this account's recipe palette)")
    .option("--out <file>", "Write the SKILL.md to a file instead of stdout")
    .action((opts: { out?: string }) => {
      const markdown = runSkill(opts);
      if (opts.out) {
        process.stderr.write(`wrote ${opts.out}\n`);
      } else {
        process.stdout.write(markdown + "\n");
      }
    });

  cli.help();
  cli.version("0.0.0");
  return cli;
}

/**
 * Default {@link Confirm}: read a single y/N line from stdin. Anything but
 * `y`/`yes` (case-insensitive) aborts. `--yes` skips this entirely, so it only
 * runs in an attended terminal.
 */
const stdinConfirm: Confirm = (id: string): Promise<boolean> => {
  process.stderr.write(`Delete ${id}? This tombstones the page. [y/N] `);
  return new Promise<boolean>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (chunk: Buffer) => {
      process.stdin.pause();
      const answer = chunk.toString("utf8").trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
};

/**
 * Build the read-path api-client for `find` / `get` from the active account's
 * token. `publish` / `update` build their own client inside `*FromFile` (they
 * also need the home palette), so this is the read-verb seam only.
 */
function makeClient(endpoint?: string) {
  const home = resolveHome();
  const account = readActiveAccount(home.root);
  if (!account) {
    throw new Error(
      "not logged in — run `shortwind-cloud login` (no active account in the Shortwind home)",
    );
  }
  return createApiClient({
    baseUrl: resolveBaseUrl(endpoint),
    token: account.token.accessToken,
  });
}

/**
 * The scopes the active account currently holds (empty when no account / no
 * recorded scopes). Drives the bind-domain pre-flight step-up decision.
 */
function activeScopes(): readonly string[] {
  const home = resolveHome();
  const account = readActiveAccount(home.root);
  return account?.scopes ?? [];
}

/**
 * The bind-domain step-up grant (PRD §7.2): re-run the device flow (`login`)
 * requesting the active account's existing scopes PLUS `domains:bind`, so the
 * human approves the privileged grant.
 *
 * The elevated `domains:bind` capability is for THIS bind only — it is requested
 * over the wire (and lives on the minted token) but is NOT persisted into the
 * stored credential's scopes (`persistScopes` keeps only the pre-existing set),
 * so it never leaks into every later token. The handler gets the elevated scope
 * set in-memory via the return value.
 */
async function stepUpBindScope(endpoint?: string): Promise<StepUpOutcome> {
  process.stderr.write(
    `binding a custom domain needs the ${BIND_SCOPE} scope — re-authorizing (PRD §7.2)\n`,
  );
  const existing = activeScopes();
  const requested = Array.from(new Set([...existing, BIND_SCOPE]));
  const result = await login({
    scope: requested,
    // Persist only the pre-existing scopes — do NOT bake domains:bind into the
    // stored credential (it is a single-operation elevation).
    persistScopes: [...existing],
    ...(endpoint ? { endpoint } : {}),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  // The elevated scope is live on the just-minted token for this operation only.
  return { ok: true, scopes: requested };
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = buildRealCli();
  // cac's parse() invokes the matched action but does NOT await it; parse
  // without running, then await the matched command so an async rejection
  // flows back to bin.ts's `run().catch` instead of escaping as an unhandled
  // rejection (same idiom as packages/cli).
  cli.parse(argv, { run: false });
  await cli.runMatchedCommand();
}
