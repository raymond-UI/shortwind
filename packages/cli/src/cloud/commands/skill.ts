import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildRegistry,
  parseRecipeFile,
  renderSkillMarkdown,
  type Recipe,
  type Registry,
} from "@shortwind/core";
import { resolveHome, type ResolvedHome } from "../../home.js";
import { RESERVED_SLUGS } from "../contract/slug.js";

/**
 * `skill` — emit the Shortwind Cloud SKILL (PRD §7.3, the "works-today"
 * discovery layer).
 *
 * The SKILL is a DIRECTORY, not one file, because its two halves have different
 * audiences and different lifetimes:
 *
 *   - `SKILL.md` — how to INVOKE the CLI on an arbitrary machine, the verbs,
 *     and which publish path a given input takes. Fixed bytes for every user.
 *   - `references/publishing.md` — slugs, visibility, tags, bundles, domains,
 *     failure modes. Read on demand, so the always-loaded SKILL stays short.
 *   - `references/recipes.md` — THIS account's recipe palette (§5.7 discovery).
 *
 * Splitting the palette out is deliberate. Recipes are a convenience for
 * composing HTML, never a precondition for hosting it, and an earlier revision
 * that welded the palette into the publish instructions taught agents the
 * opposite: an account with an empty `recipes/` read "No families installed
 * yet" as a reason not to publish at all.
 *
 * The palette reuses `@shortwind/core`'s {@link renderSkillMarkdown} over the
 * active home's `recipes/` (the same generator the local CLI uses), so the
 * cloud palette never drifts from the local one.
 *
 * Rendering is split into a PURE core ({@link renderCloudSkillFiles}, takes a
 * {@link Registry}) and an IO shell ({@link runSkill}, reads the home palette
 * and writes/prints), so the golden test drives a fixed palette with no disk.
 */

export interface SkillOptions {
  /**
   * Write the SKILL to this path instead of stdout. The reference files are
   * written to a `references/` directory alongside it.
   */
  out?: string;
}

/** One rendered SKILL file, at its path RELATIVE to the skill directory. */
export interface SkillFile {
  relativePath: string;
  contents: string;
}

// ---------------------------------------------------------------------------
// The cloud-verbs section — a stable, hand-authored contract block. This is the
// half an agent reads to know WHICH verbs exist; the palette half (below) tells
// it which recipes exist.
// ---------------------------------------------------------------------------

const SKILL_NAME = "shortwind-cloud";
const SKILL_DESCRIPTION =
  "Publish HTML to a real, shareable URL on Shortwind Cloud, and find, update, or take down pages already published. Use when asked to host, deploy, share, or produce a link for a mockup, report, dashboard, or any HTML page.";

/** Relative paths of the on-demand reference documents, cited from SKILL.md. */
const PUBLISHING_REF = "references/publishing.md";
const RECIPES_REF = "references/recipes.md";

/** Each cloud verb: the CLI invocation, the REST route, and a one-line intent. */
interface VerbDoc {
  usage: string;
  route: string;
  blurb: string;
}

/** Verb groups, in the order an agent needs them: pages, then account, then domains. */
const VERB_GROUPS: { heading: string; note?: string; verbs: VerbDoc[] }[] = [
  {
    heading: "Pages",
    verbs: [
      {
        usage: "shortwind cloud find [--q <text>] [--tag <t>] [--json]",
        route: "GET /v1/pages",
        blurb: "Locate pages this account already published. Run this before publishing; the account is the only memory.",
      },
      {
        usage: "shortwind cloud publish <file.html> [--domain <slug>] [--bundle] [--tag <t>] [--visibility <level>] [--idempotency-key <k>] [--json]",
        route: "POST /v1/pages (POST /v1/bundles with --bundle)",
        blurb: "Create a NEW page. With --bundle, publish the file's whole directory as one linked multi-page site. A slug already in use returns 409 with the existing id; switch to update.",
      },
      {
        usage: "shortwind cloud update <id> <file.html> [--idempotency-key <k>] [--json]",
        route: "PATCH /v1/pages/{id}",
        blurb: "Republish to the SAME URL as a new version. This is how you revise; publishing again does not replace a page.",
      },
      {
        usage: "shortwind cloud get <id> [--json]",
        route: "GET /v1/pages/{id}",
        blurb: "Fetch metadata and version history to confirm state before acting.",
      },
      {
        usage: "shortwind cloud visibility <id> <public|unlisted|private> [--json]",
        route: "PATCH /v1/pages/{id}/visibility",
        blurb: "Change the access level of a page already published.",
      },
      {
        usage: "shortwind cloud delete <id> [-y|--yes] [--json]",
        route: "DELETE /v1/pages/{id}",
        blurb: "Tombstone a page so the URL stops serving. Pass --yes when unattended, or it waits on a prompt.",
      },
    ],
  },
  {
    heading: "Account",
    verbs: [
      {
        usage: "shortwind cloud whoami [--json]",
        route: "identity, scopes, endpoint",
        blurb: "The cheapest check that the CLI resolves AND the stored token works. Use it as the probe in step 1 above.",
      },
      {
        usage: "shortwind cloud login [--scope <scope>]",
        route: "OAuth device flow",
        blurb: "Needed once per machine. It is interactive: never run it speculatively. --scope REPLACES the grant, so if you ever pass it, pass every scope you still need.",
      },
      {
        usage: "shortwind cloud init-global [--force]",
        route: "creates ~/.shortwind/",
        blurb: "Create the global home. Login does this for you; run it only if the home is missing.",
      },
    ],
  },
  {
    heading: "Custom domains (bound to the ACCOUNT, not to one page)",
    verbs: [
      {
        usage: "shortwind cloud domains [--json]",
        route: "GET /v1/domains",
        blurb: "List the account's custom domains and their status.",
      },
      {
        usage: "shortwind cloud bind-domain <hostname> [--json]",
        route: "POST /v1/domains",
        blurb: "Bind a hostname to the account. It re-authorizes itself for the domains:bind scope, so do NOT run login by hand for it.",
      },
      {
        usage: "shortwind cloud approve-domain <hostname> [--json]",
        route: "POST /v1/domains/approve",
        blurb: "Approve a domain that is waiting on human confirmation.",
      },
    ],
  },
];

/**
 * Render `SKILL.md`: frontmatter, how to INVOKE the CLI anywhere, the publish
 * routing table, and the verbs. Deliberately takes no {@link Registry} — this
 * document is identical on every machine, so an empty palette can never make it
 * read as though publishing were unavailable.
 */
export function renderCloudSkill(): string {
  const parts: string[] = [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${SKILL_DESCRIPTION}`,
    "---",
    "",
    "<!-- AUTO-GENERATED by `shortwind cloud skill`. Re-run it to refresh; local edits are overwritten. -->",
    "",
    "# Shortwind Cloud",
    "",
    "Shortwind Cloud hosts an HTML file at a real, shareable URL. Any HTML publishes: no build step, no framework, and no Shortwind recipes required. If the file opens in a browser, it ships as authored.",
    "",
    "The CLI keeps no state. It never remembers a page id, so `find` an existing page, then `publish` a new one or `update` the id you found. The account is the only memory.",
    "",
    "## Running the CLI",
    "",
    "Every example below is written `shortwind cloud <verb>`. Resolve that command in this order, and do not stop at the first failure:",
    "",
    "1. Run `shortwind cloud whoami --json`. If it succeeds, `shortwind` is on PATH; use the examples as written.",
    "2. If step 1 prints `command not found`, run every verb as `npx -y @shortwind/cli cloud <verb>` instead. It needs only Node, installs nothing permanently, and behaves identically. (`pnpm dlx @shortwind/cli` and `bunx @shortwind/cli` are equivalent where npx is unavailable.)",
    "",
    "A global install usually lives in a package-manager bin directory (npm, pnpm, yarn, bun, Homebrew, asdf, volta, and others) that a non-interactive shell does not put on PATH. `command not found` therefore means \"invoke it another way\", not \"Cloud is unavailable\". Never report publishing as blocked, unavailable, or not installed without having tried step 2, and never hardcode an absolute path to the binary: it differs on every machine.",
    "",
    "Credentials live at `~/.shortwind/credentials.json`, and every invocation route reads that same file, so the `npx` route is already authenticated whenever `shortwind cloud login` has run on this machine. Run `login` only after a verb actually returns 401; it is interactive and will stall an unattended session.",
    "",
    "## Choose the publish path",
    "",
    "| What you have | Command |",
    "| --- | --- |",
    "| One self-contained `.html` file | `shortwind cloud publish <file> --domain <slug>` |",
    "| Several linked `.html` files in one directory | `shortwind cloud publish <entry.html> --bundle --domain <slug>` |",
    "| A revision of a page already published | `shortwind cloud update <id> <file>` |",
    "",
    "Four rules that prevent the usual mistakes:",
    "",
    "1. `find` before you publish. A page from an earlier session is discoverable only through the account.",
    "2. Always pass `--domain <slug>`. Omitting it falls back to the document title, then the file name, then an opaque handle, so the URL says whatever the document happens to be called rather than what the user would call it.",
    "3. Revise with `update <id>`, never a second `publish`. Publishing again mints a second page at a second URL; it does not move or replace the first.",
    "4. Report the `id` and `url` from the response back to the user. Nothing on disk remembers them for the next session.",
    "",
    `Slugs, visibility, tags, bundle layout, custom domains, and failure handling are in \`${PUBLISHING_REF}\`. Read it before any publish beyond a single plain file.`,
    "",
    "## Verbs",
    "",
    "Every verb authenticates with the active account. Add `--json` to any of them for machine-readable output, which is the form to parse.",
    "",
  ];
  for (const group of VERB_GROUPS) {
    parts.push(`### ${group.heading}`);
    parts.push("");
    for (const v of group.verbs) {
      parts.push(`- \`${v.usage}\``);
      parts.push(`  - ${v.route}. ${v.blurb}`);
    }
    parts.push("");
  }
  parts.push("## Recipes are optional");
  parts.push("");
  parts.push(
    "Shortwind recipes are named class shorthands (`@card`, `@btn`) that expand to Tailwind when a page is published. They are a convenience for composing UI, never a precondition for hosting it. A file that never mentions a recipe publishes and renders exactly as authored, whether it uses hand-written CSS, a Tailwind CDN build, or inline styles. An empty palette is not a reason to delay a publish.",
  );
  parts.push("");
  parts.push(
    `Read \`${RECIPES_REF}\` only when you want to compose with THIS account's recipe vocabulary. It lists the exact names installed. Never invent one: a name the account does not ship expands to nothing and ships as visible raw text in the page.`,
  );
  parts.push("");
  return parts.join("\n");
}

/**
 * Render `references/publishing.md`: everything a publish beyond one plain file
 * needs. Kept OUT of SKILL.md so the always-loaded document stays short enough
 * to be read in full, and pulled in only once an agent commits to publishing.
 */
function renderPublishingReference(): string {
  return [
    "# Shortwind Cloud: publishing reference",
    "",
    "Companion to the `shortwind-cloud` SKILL. Every command here follows the invocation rules in `SKILL.md`: `shortwind cloud <verb>` when it is on PATH, otherwise `npx -y @shortwind/cli cloud <verb>`.",
    "",
    "## A single page",
    "",
    "```",
    "shortwind cloud publish report.html --domain q3-report --visibility unlisted --json",
    "```",
    "",
    "The file uploads as-is. Inline CSS, inline JS, CDN `<script>`/`<link>` tags, data URIs, and absolute image URLs all keep working, because nothing is bundled or rewritten.",
    "",
    "A single-page publish carries exactly one file, so a local relative asset (`./logo.png`) is NOT uploaded and will 404. Inline it, use a data URI, point at an absolute URL, or publish the directory with `--bundle`.",
    "",
    "The response carries `id`, `url`, and `version`. Treat `url` as authoritative and never assemble one from the slug by hand; the host shape is the platform's to decide.",
    "",
    "## A multi-page site",
    "",
    "```",
    "shortwind cloud publish site/index.html --bundle --domain my-site --json",
    "```",
    "",
    "- Deploys every `.html` file under the entry file's directory as ONE unit. The entry is what the slug resolves to.",
    "- Each file serves at its authored path: `index.html` at `/`, `docs/guide.html` at `/docs/guide.html`.",
    "- Relative links between those pages work exactly as written. There is no link rewriting, so author `<a href=\"docs/guide.html\">` normally.",
    "- The bundle is one unit for versioning, visibility, and takedown; it inherits the entry page's lifecycle.",
    "",
    "## Slugs",
    "",
    "- `--domain <slug>` sets the handle. Grammar: lowercase letters and digits in hyphen-separated groups, up to 63 characters (`q3-report`, `acme-pricing-v2`).",
    "- Pick something a human would recognize: the product or the document, not the file name or the framework.",
    `- These handles are reserved and will be refused: ${RESERVED_SLUGS.join(", ")}.`,
    "- Omit `--domain` and the handle comes from the document title, else the file name, else an opaque `page-<id>`. That is a fallback, not a naming scheme: pass `--domain` so the URL reads as the thing it is.",
    "- Publishing to a slug this account already uses returns 409 WITH the existing page id. That is the signal to `update <id> <file>`, not to pick a different slug.",
    "",
    "## Visibility",
    "",
    "Set it at publish time with `--visibility`, or afterwards with `shortwind cloud visibility <id> <level>`.",
    "",
    "- `public`: listed and indexable.",
    "- `unlisted`: reachable by anyone holding the link, but not listed. The right choice for a mockup or draft shared in an issue or a chat.",
    "- `private`: requires an authenticated session on the owning account. Do not use it for a link someone else must open; they will hit a login wall.",
    "",
    "Prefer `unlisted` when the user just wants a link to share, and confirm before publishing anything `public` on their behalf.",
    "",
    "## Tags",
    "",
    "`--tag` is repeatable and is the only retrieval handle besides the slug. Tag on the way in, because `find --tag` is how a later session finds the page again.",
    "",
    "```",
    "shortwind cloud publish mock.html --domain acme-mock --tag acme --tag design-mock",
    "```",
    "",
    "## Revising a page",
    "",
    "```",
    "shortwind cloud find --q acme --json      # recover the id",
    "shortwind cloud update <id> mock.html --json",
    "```",
    "",
    "`update` republishes to the same URL as a new version; `get <id> --json` lists the version history. Published versions are frozen, so an update adds a version rather than mutating the last one.",
    "",
    "## Custom domains",
    "",
    "Custom domains bind to the ACCOUNT, not to an individual page.",
    "",
    "```",
    "shortwind cloud domains --json",
    "shortwind cloud bind-domain mockups.acme.com --json",
    "shortwind cloud approve-domain mockups.acme.com --json",
    "```",
    "",
    "`bind-domain` needs the `domains:bind` scope and performs that step-up itself, so there is nothing to do first. Never re-run login with `--scope domains:bind` alone: `--scope` REPLACES the grant rather than adding to it, so that token would lose `pages:read`/`pages:write` and every later publish would 403. If a manual login is ever unavoidable, pass the whole set: `shortwind cloud login --scope pages:read --scope pages:write --scope domains:bind`. A domain can land in a pending-human state that `approve-domain` clears once DNS verification passes.",
    "",
    "## When something fails",
    "",
    "| Symptom | Meaning | Do this |",
    "| --- | --- | --- |",
    "| `command not found` | The binary is not on this shell's PATH | Re-run via `npx -y @shortwind/cli cloud ...`. This is not a blocker. |",
    "| 401 | No token, or it expired | `shortwind cloud login`, then retry. |",
    "| 403 naming a scope | The token lacks that scope | For `domains:bind`, just re-run `bind-domain`: it steps up on its own. Otherwise re-run login passing EVERY scope you need (`--scope` replaces the grant, it does not add to it). |",
    "| 409 on publish | The slug is taken; the response carries the existing id | `update <id> <file>`. Do not invent a new slug. |",
    "| A URL you did not choose | `--domain` was omitted, so the handle came from the document title or file name | `update` cannot move a URL: publish once at the right slug, then `delete` the wrong page. |",
    "| Raw `@name` text visible on the page | A recipe this account does not ship | Remove it, or use a name from `recipes.md`. |",
    "",
    "Retrying a publish that may have partly succeeded: pass the same `--idempotency-key <key>` and the retry returns the original result instead of creating a second page.",
    "",
    "## Cleaning up",
    "",
    "```",
    "shortwind cloud delete <id> --yes --json",
    "```",
    "",
    "Deletion is a tombstone: the URL stops serving. Pass `--yes` when running unattended, or the command waits on a confirmation prompt. Deleting a page whose link a human already holds is destructive, so confirm before doing it.",
    "",
  ].join("\n");
}

/**
 * Render `references/recipes.md`: this account's palette, framed as OPTIONAL.
 * The palette body is core's {@link renderSkillMarkdown} (frontmatter stripped),
 * so the cloud and local vocabularies can never drift.
 */
export function renderRecipesReference(registry: Registry): string {
  return [
    "# Shortwind Cloud: recipe palette (optional)",
    "",
    "Companion to the `shortwind-cloud` SKILL. Nothing in this file is required in order to publish. Plain HTML, hand-written CSS, a Tailwind CDN build, and inline styles all publish and render exactly as authored.",
    "",
    "Read on only to compose HTML from THIS account's recipe vocabulary. The names below are the ones actually installed here. A name that is not listed expands to nothing and ships as visible raw text, so never invent one and never carry names over from another project: re-read this file instead.",
    "",
    stripFrontmatter(renderSkillMarkdown(registry)),
  ].join("\n");
}

/**
 * The complete SKILL directory as plain data: `SKILL.md` plus its references,
 * at paths relative to the skill root. Pure, so the golden test can assert
 * every file's bytes without touching disk.
 */
export function renderCloudSkillFiles(registry: Registry): SkillFile[] {
  return [
    { relativePath: "SKILL.md", contents: renderCloudSkill() },
    { relativePath: PUBLISHING_REF, contents: renderPublishingReference() },
    { relativePath: RECIPES_REF, contents: renderRecipesReference(registry) },
  ];
}

/**
 * Drop the leading `---`…`---` YAML frontmatter block (and the blank line after
 * it) from a rendered SKILL.md, so core's palette output embeds under the cloud
 * document's single frontmatter instead of carrying its own.
 */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return markdown;
  // Skip past the closing fence and any single trailing blank line.
  let rest = markdown.slice(end + "\n---\n".length);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return rest;
}

// ---------------------------------------------------------------------------
// IO shell — load the home palette into a Registry, then render + emit.
// ---------------------------------------------------------------------------

/**
 * Load the recipe families from a home's `recipes/` dir into a {@link Registry}
 * (leniently — a family that fails to resolve is skipped, never throws, so the
 * skill still advertises everything that DID parse). Mirrors the local CLI's
 * `loadInstalledRegistry`, kept local here because `@shortwind/cli` is not a
 * cloud dependency.
 */
export function loadHomePalette(recipesDir: string): Registry {
  if (!existsSync(recipesDir)) return { flattened: {}, families: {} };
  const allRecipes: Recipe[] = [];
  const guidance: Record<string, string> = {};
  const families = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.slice(0, -".css".length))
    .sort();
  for (const family of families) {
    const source = readFileSync(path.join(recipesDir, `${family}.css`), "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (!parsed.ok) continue;
    allRecipes.push(...parsed.value.recipes);
    if (parsed.value.guidance) guidance[family] = parsed.value.guidance;
  }
  const built = buildRegistry(allRecipes, { guidance });
  if (built.ok) return built.value;
  // Degrade to a name-only registry so the palette still lists the recipes.
  return { flattened: Object.fromEntries(allRecipes.map((r) => [r.name, []])), families: {} };
}

/**
 * Write a rendered SKILL directory: `SKILL.md` at `skillFile`, and each
 * reference at its relative path BELOW that file's directory. Returns the
 * absolute paths written, in render order.
 */
export function writeSkillFiles(skillFile: string, files: SkillFile[]): string[] {
  const root = path.dirname(path.resolve(skillFile));
  const written: string[] = [];
  for (const file of files) {
    // SKILL.md honours the caller's exact filename; references hang off its dir.
    const target =
      file.relativePath === "SKILL.md" ? path.resolve(skillFile) : path.join(root, file.relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents.endsWith("\n") ? file.contents : file.contents + "\n");
    written.push(target);
  }
  return written;
}

/**
 * Run `skill`: resolve the active home, load its palette, render the SKILL
 * directory, and either return SKILL.md (stdout) or write every file under
 * `--out`. Returns the SKILL.md markdown so cli.ts can print it.
 */
export function runSkill(opts: SkillOptions, home: ResolvedHome = resolveHome()): string {
  const files = renderCloudSkillFiles(loadHomePalette(home.recipesDir));
  if (opts.out) writeSkillFiles(opts.out, files);
  // Re-render rather than indexing into `files`: an index would silently print
  // "" (or a reference) if the array order ever changed.
  return renderCloudSkill();
}
