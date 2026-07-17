import {
  globalHomeRoot,
  loadCredentials,
  type Credentials,
  type HomeEnv,
} from "../../home.js";
import { resolveBaseUrl } from "../api-client.js";

/**
 * `whoami` — show the active cloud identity (like `gh auth status`).
 *
 * Reads the credentials store (the GLOBAL home, where login writes — identity is
 * machine-global, see {@link readActiveCloudAccount}) and reports the active
 * account: its label, id, granted scopes, the API endpoint it will call, and any
 * other stored accounts. Local + offline — it reflects what the CLI holds, not a
 * server round-trip (there is no `/me` endpoint; the account is the only memory).
 *
 * Split PURE ({@link renderWhoami}, over a loaded {@link Credentials}) + IO shell
 * ({@link runWhoami}, reads the home) so the golden test drives fixed creds with
 * no disk. Exit code is 1 when not logged in (scriptable, mirrors `gh`).
 */

export interface WhoamiOptions {
  json?: boolean;
  endpoint?: string;
}

/** The env slice whoami reads: home resolution + the API-origin override. */
export type WhoamiEnv = HomeEnv & { SHORTWIND_CLOUD_API?: string | undefined };

export interface WhoamiOutcome {
  output: string;
  loggedIn: boolean;
}

/**
 * Render the whoami output from loaded credentials + the resolved endpoint. Pure.
 * `--json` emits a stable machine-readable object; the human form is a short
 * `gh`-style block.
 */
export function renderWhoami(
  creds: Credentials,
  endpoint: string,
  json: boolean,
): WhoamiOutcome {
  const active = creds.active ? (creds.accounts[creds.active] ?? null) : null;
  const others = Object.values(creds.accounts)
    .filter((a) => a.id !== creds.active)
    .map((a) => a.label);

  if (json) {
    const payload = active
      ? {
          loggedIn: true,
          endpoint,
          active: {
            id: active.id,
            label: active.label,
            scopes: active.scopes ?? [],
            since: active.addedAt ?? null,
          },
          accounts: Object.values(creds.accounts).map((a) => ({
            id: a.id,
            label: a.label,
            active: a.id === creds.active,
          })),
        }
      : { loggedIn: false, endpoint, active: null, accounts: [] };
    return { output: JSON.stringify(payload, null, 2), loggedIn: Boolean(active) };
  }

  if (!active) {
    return {
      output: "Not logged in. Run `shortwind cloud login`.",
      loggedIn: false,
    };
  }

  const lines = [
    `Logged in to Shortwind Cloud as ${active.label}`,
    `  account:  ${active.id}`,
    `  scopes:   ${(active.scopes ?? []).join(", ") || "(none recorded)"}`,
    `  endpoint: ${endpoint}`,
  ];
  if (active.addedAt) lines.push(`  since:    ${active.addedAt}`);
  if (others.length > 0) {
    lines.push("");
    lines.push(`Other accounts: ${others.join(", ")} (switch with \`shortwind cloud login\`)`);
  }
  return { output: lines.join("\n"), loggedIn: true };
}

/**
 * Run `whoami`: load the global home's credentials + resolve the endpoint, then
 * render. Reads `process.env` by default; tests inject a sandbox `HOME` /
 * `SHORTWIND_HOME`.
 */
export function runWhoami(
  opts: WhoamiOptions,
  env: WhoamiEnv = process.env as WhoamiEnv,
): WhoamiOutcome {
  const creds = loadCredentials(globalHomeRoot(env));
  const endpoint = resolveBaseUrl(opts.endpoint, env);
  return renderWhoami(creds, endpoint, Boolean(opts.json));
}
