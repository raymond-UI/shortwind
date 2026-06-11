import { twMerge } from "tailwind-merge";
import type { Registry } from "./types.js";

export type ExpandMode = "html" | "jsx";
export type ExpandOptions = {
  mode?: ExpandMode;
  mergeConflicts?: boolean;
  /**
   * Top-level function names whose string/template arguments should be
   * scanned for `@recipe` tokens. Defaults to ["cva", "tv"] in jsx mode,
   * empty in html mode. Covers the cva/tailwind-variants UI pattern where
   * variant definitions live in module scope outside any className=.
   */
  callExpanders?: readonly string[];
};

const DEFAULT_CALL_EXPANDERS_JSX: readonly string[] = ["cva", "tv"];

// Wrap an expanded class value in a host quote, switching delimiter when the
// value contains it so a legitimate single-quote arbitrary value
// (`content-['→']`) can't break out of a single-quoted attribute. Double-quotes
// in tokens are rejected at resolve time, so expanded values never contain `"`
// — making `"` always a safe fallback delimiter.
function quoteAttr(preferred: '"' | "'", value: string): string {
  if (preferred === "'" && value.includes("'")) return `"${value}"`;
  return `${preferred}${value}${preferred}`;
}

// Escape an expanded class value for splicing inside a JS string literal of the
// given delimiter. Backslashes first, then the delimiter (and `${` for
// templates). The runtime string value is unchanged; this only keeps the source
// valid so a `content-['→']` token can't break `cva('…')` and a hostile token
// can't inject code. Shared with the Babel JSX transform (@shortwind/tailwind).
export function escapeForStringLiteral(value: string, quote: '"' | "'" | "`"): string {
  const out = value.replace(/\\/g, "\\\\");
  if (quote === "'") return out.replace(/'/g, "\\'");
  if (quote === "`") return out.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return out.replace(/"/g, '\\"');
}

export function escapeForTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

export function expand(
  input: string,
  registry: Registry,
  options: ExpandOptions = {},
): string {
  const mode = options.mode ?? "html";
  const merge = options.mergeConflicts ?? true;

  let out = input;

  if (mode === "jsx") {
    out = rewriteClassAttr(out, "class", registry, merge);
    out = rewriteClassAttr(out, "className", registry, merge);
    out = expandJsxBraced(out, registry, merge);
    const callExpanders = options.callExpanders ?? DEFAULT_CALL_EXPANDERS_JSX;
    if (callExpanders.length > 0) {
      out = expandCallStringArgs(out, callExpanders, registry, merge);
    }
  } else {
    // html mode (.astro/.vue/.svelte/.html): the attribute regexes are blind to
    // syntax. First expand cva()/tv() ONLY inside code regions (<script> blocks,
    // Astro frontmatter) so prose like `<p>call cva("@card")</p>` is never
    // rewritten. Then mask comments / frontmatter / <script> / <style> so the
    // attribute regexes can't touch JS/CSS (`obj.class = "px-2 p-4"`), rewrite
    // class= on what's left, and restore the masked regions verbatim.
    if (options.callExpanders && options.callExpanders.length > 0) {
      out = expandCallsInCodeRegions(out, options.callExpanders, registry, merge);
    }
    const { masked, restore } = maskHtmlOpaqueRegions(out);
    out = restore(rewriteClassAttr(masked, "class", registry, merge));
  }

  return out;
}

// Run the cva()/tv() call-expander pass only within <script> blocks and a
// leading Astro `---` frontmatter fence — the only places those calls
// legitimately live — so template prose is never matched.
function expandCallsInCodeRegions(
  input: string,
  callNames: readonly string[],
  registry: Registry,
  merge: boolean,
): string {
  let out = input.replace(
    /^(---\r?\n)([\s\S]*?)(\r?\n---)/,
    (_m, open: string, body: string, close: string) =>
      open + expandCallStringArgs(body, callNames, registry, merge) + close,
  );
  out = out.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (_m, open: string, body: string, close: string) =>
      open + expandCallStringArgs(body, callNames, registry, merge) + close,
  );
  return out;
}

function rewriteClassAttr(
  input: string,
  attr: "class" | "className",
  registry: Registry,
  merge: boolean,
): string {
  let out = input.replace(
    new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "g"),
    (_m, cls: string) => `${attr}=${quoteAttr('"', expandClassList(cls, registry, merge))}`,
  );
  out = out.replace(
    new RegExp(`\\b${attr}\\s*=\\s*'([^']*)'`, "g"),
    (_m, cls: string) => `${attr}=${quoteAttr("'", expandClassList(cls, registry, merge))}`,
  );
  return out;
}

// Replace HTML comments, a leading Astro `---` frontmatter fence, and
// <script>/<style> blocks with opaque placeholders so the attribute-rewriting
// regexes never see their (commented / JS / CSS) contents, then restore them
// verbatim. The placeholder is a plain ASCII token (no `class=`, no `@`, no
// quotes) — and ASCII, not NUL, so the source file stays text (git
// diff/blame/grep keep working).
//
// Comments are masked FIRST so a commented-out `<script>` (`<!-- <script> -->`)
// can't make the <script> regex swallow real markup up to the next </script>.
// Unclosed comments are masked to EOF so a truncated file's contents still
// can't be corrupted by the attribute regexes; unclosed <script>/<style> get
// the clipped fallback in maskTagBlocks (#60).
function maskHtmlOpaqueRegions(input: string): {
  masked: string;
  restore: (s: string) => string;
} {
  const stash: string[] = [];
  // Collision defense: the input may legitimately contain text that looks like
  // a placeholder (documentation about shortwind, tests of this very file).
  // Grow the sentinel until it occurs nowhere in the input, so restore() can
  // only ever match tokens this call minted — never user text.
  let sentinel = "__SHORTWIND_MASK_";
  while (input.includes(sentinel)) sentinel = sentinel.replace("MASK", "MASKX");
  const mask = (m: string): string => {
    const token = `${sentinel}${stash.length}__`;
    stash.push(m);
    return token;
  };
  let masked = input;
  masked = masked.replace(/<!--[\s\S]*?-->|<!--[\s\S]*$/g, mask);
  masked = masked.replace(/^---\r?\n[\s\S]*?\r?\n---/, mask);
  masked = maskTagBlocks(masked, "script", mask);
  masked = maskTagBlocks(masked, "style", mask);
  // A masked region (e.g. a comment) can itself contain a placeholder from an
  // earlier-masked nested region, so restore until stable.
  const maskRe = new RegExp(`${sentinel}(\\d+)__`, "g");
  const restore = (s: string): string => {
    let prev: string;
    let cur = s;
    do {
      prev = cur;
      cur = cur.replace(maskRe, (whole, i: string) => stash[Number(i)] ?? whole);
    } while (cur !== prev);
    return cur;
  };
  return { masked, restore };
}

// An element-open that carries a class/className attribute — the shape the
// clipped unclosed-<script> fallback must never swallow (see maskTagBlocks).
const CLASS_BEARING_ELEMENT_RE = /<[a-zA-Z][^<>]*\bclass(?:Name)?\s*=/;

// Mask `<tag …>…</tag>` blocks. A paired block is masked whole. An UNCLOSED
// open tag used to mask all the way to EOF (so a truncated file's JS/CSS can't
// be corrupted by the attribute regexes) — but adapter inputs legitimately
// contain a `<script` whose closing tag is not a literal in the same chunk
// (e.g. Astro's compiled modules, #60), and masking to EOF there silently
// swallowed every static recipe downstream. Compromise: clip the fallback mask
// just before the next element that carries a class/className attribute. A
// genuinely truncated file has no such element after the cut, so its trailing
// JS still masks to EOF; compiled inputs keep their downstream markup
// expandable.
function maskTagBlocks(
  input: string,
  tag: "script" | "style",
  mask: (m: string) => string,
): string {
  const openRe = new RegExp(`<${tag}\\b`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "i");
  let out = "";
  let pos = 0;
  for (;;) {
    openRe.lastIndex = pos;
    const open = openRe.exec(input);
    if (!open) {
      out += input.slice(pos);
      break;
    }
    out += input.slice(pos, open.index);
    const rest = input.slice(open.index);
    const close = rest.match(closeRe);
    if (close && close.index !== undefined) {
      const end = close.index + close[0].length;
      out += mask(rest.slice(0, end));
      pos = open.index + end;
      continue;
    }
    // Unclosed: search from index 1 so the open tag's own `<` can't match.
    const clip = rest.slice(1).match(CLASS_BEARING_ELEMENT_RE);
    if (clip && clip.index !== undefined) {
      const end = 1 + clip.index;
      out += mask(rest.slice(0, end));
      pos = open.index + end;
      continue;
    }
    out += mask(rest);
    break;
  }
  return out;
}

export function expandClassList(
  classList: string,
  registry: Registry,
  mergeConflicts: boolean,
): string {
  const tokens = classList.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let expandedAny = false;
  for (const t of tokens) {
    if (t.startsWith("@")) {
      const name = t.slice(1);
      // `Object.hasOwn` + array check, never a bare truthy lookup: a class like
      // `@constructor` would otherwise resolve an inherited `Object.prototype`
      // member and crash the spread below with a non-iterable value.
      const expanded = Object.hasOwn(registry.flattened, name)
        ? registry.flattened[name]
        : undefined;
      if (Array.isArray(expanded)) {
        for (const e of expanded) out.push(e);
        expandedAny = true;
      } else {
        out.push(t);
      }
    } else {
      out.push(t);
    }
  }
  // No recipe token expanded — return the input untouched. Running twMerge on a
  // recipe-free list would silently rewrite it (drop "duplicates", reorder
  // conflicts against the cascade, collapse whitespace), so installing one
  // recipe must not change the rendering of recipe-free markup.
  if (!expandedAny) return classList;
  const joined = out.join(" ");
  const result = mergeConflicts ? twMerge(joined) : joined;
  // Line stability (#48): a multi-line class value collapses to one line on
  // expansion, which shifts every subsequent source line (breaking stack traces
  // and breakpoints in the absence of a sourcemap). Re-append the newlines the
  // collapse removed so the downstream line count stays correct. A real
  // sourcemap from the adapters is the eventual, exact fix.
  const removed = countNewlines(classList) - countNewlines(result);
  return removed > 0 ? result + "\n".repeat(removed) : result;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

const CLASSNAME_KW = "className";

// Both `expandJsxBraced` and `expandCallStringArgs` need a top-level scan that
// skips over JS line/block comments, string literals, and template literals so
// they don't false-match their trigger words inside non-code regions. Returns
// the slice to emit verbatim and the new cursor, or null if `input[i]` is not
// the start of one of those constructs.
//
// This function does NOT recognize regex literals — telling `/foo/g` apart
// from a division requires a parser. Once comments are excluded, bare regex
// literals at module scope are rare enough that the cost outweighs the win.
// If you write `cva(/"/.test(x) ? "@a" : "@b")` you're outside the contract.
function skipOpaqueChunk(
  input: string,
  i: number,
): { end: number; emit: string } | null {
  const ch = input[i];
  if (ch === "/" && input[i + 1] === "/") {
    const nl = input.indexOf("\n", i);
    const end = nl < 0 ? input.length : nl;
    return { end, emit: input.slice(i, end) };
  }
  if (ch === "/" && input[i + 1] === "*") {
    const close = input.indexOf("*/", i + 2);
    const end = close < 0 ? input.length : close + 2;
    return { end, emit: input.slice(i, end) };
  }
  if (ch === '"' || ch === "'") {
    const open = ch;
    let j = i + 1;
    while (j < input.length && input[j] !== open) {
      if (input[j] === "\\") j++;
      j++;
    }
    const end = j < input.length ? j + 1 : j;
    return { end, emit: input.slice(i, end) };
  }
  if (ch === "`") {
    let j = i + 1;
    while (j < input.length && input[j] !== "`") {
      if (input[j] === "\\") {
        j += 2;
        continue;
      }
      if (input[j] === "$" && input[j + 1] === "{") {
        let td = 1;
        j += 2;
        while (j < input.length && td > 0) {
          const c = input[j];
          if (c === "{") td++;
          else if (c === "}") td--;
          if (td === 0) break;
          j++;
        }
        if (j < input.length) j++;
        continue;
      }
      j++;
    }
    const end = j < input.length ? j + 1 : j;
    return { end, emit: input.slice(i, end) };
  }
  return null;
}

function expandJsxBraced(input: string, registry: Registry, merge: boolean): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const skip = skipOpaqueChunk(input, i);
    if (skip) {
      out += skip.emit;
      i = skip.end;
      continue;
    }
    if (!input.startsWith(CLASSNAME_KW, i)) {
      out += input[i];
      i++;
      continue;
    }
    const before = i > 0 ? input[i - 1] ?? "" : "";
    if (before && /[\w$]/.test(before)) {
      out += CLASSNAME_KW;
      i += CLASSNAME_KW.length;
      continue;
    }
    let j = i + CLASSNAME_KW.length;
    while (j < input.length && /\s/.test(input[j] ?? "")) j++;
    if (input[j] !== "=") {
      out += input.slice(i, j);
      i = j;
      continue;
    }
    j++;
    while (j < input.length && /\s/.test(input[j] ?? "")) j++;
    if (input[j] !== "{") {
      out += input.slice(i, j);
      i = j;
      continue;
    }
    out += input.slice(i, j + 1);
    let depth = 1;
    let k = j + 1;
    while (k < input.length && depth > 0) {
      const ch = input[k];
      if (ch === '"' || ch === "'" || ch === "`") {
        const close = ch;
        k++;
        while (k < input.length && input[k] !== close) {
          if (input[k] === "\\") k++;
          k++;
        }
        k++;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) break;
      k++;
    }
    const expr = input.slice(j + 1, k);
    out += expandJsxExpression(expr, registry, merge);
    if (k < input.length) {
      out += "}";
      i = k + 1;
    } else {
      i = k;
    }
  }
  return out;
}

// expandCallStringArgs rewrites string/template literals appearing anywhere
// inside the argument list of a recognized call like `cva(...)` or `tv(...)`.
// Used to support cva-style variant maps that sit at module scope, outside
// any className= attribute. Walks character-by-character (no JS parser),
// skipping strings/templates while finding the matching close paren, then
// hands the body to expandJsxExpression which already handles nested string
// and template literal rewriting.
function expandCallStringArgs(
  input: string,
  callNames: readonly string[],
  registry: Registry,
  merge: boolean,
): string {
  const nameSet = new Set(callNames);
  let out = "";
  let i = 0;
  while (i < input.length) {
    const skip = skipOpaqueChunk(input, i);
    if (skip) {
      out += skip.emit;
      i = skip.end;
      continue;
    }
    const ch = input[i] ?? "";
    if (!/[A-Za-z_$]/.test(ch)) {
      out += ch;
      i++;
      continue;
    }
    const before = i > 0 ? input[i - 1] ?? "" : "";
    if (before && /[\w$]/.test(before)) {
      // mid-identifier — emit the rest of this identifier verbatim and move on
      let j = i;
      while (j < input.length && /[\w$]/.test(input[j] ?? "")) j++;
      out += input.slice(i, j);
      i = j;
      continue;
    }
    let j = i;
    while (j < input.length && /[\w$]/.test(input[j] ?? "")) j++;
    const ident = input.slice(i, j);
    if (!nameSet.has(ident)) {
      out += ident;
      i = j;
      continue;
    }
    let k = j;
    while (k < input.length && /\s/.test(input[k] ?? "")) k++;
    if (input[k] !== "(") {
      out += input.slice(i, k);
      i = k;
      continue;
    }
    const bodyStart = k + 1;
    const bodyEnd = findCallBodyEnd(input, bodyStart);
    const body = input.slice(bodyStart, bodyEnd);
    out += input.slice(i, bodyStart) + expandJsxExpression(body, registry, merge);
    if (bodyEnd < input.length) {
      out += ")";
      i = bodyEnd + 1;
    } else {
      i = bodyEnd;
    }
  }
  return out;
}

function findCallBodyEnd(input: string, bodyStart: number): number {
  let depth = 1;
  let k = bodyStart;
  while (k < input.length && depth > 0) {
    const ch = input[k];
    if (ch === '"' || ch === "'") {
      const close = ch;
      k++;
      while (k < input.length && input[k] !== close) {
        if (input[k] === "\\") k++;
        k++;
      }
      k++;
      continue;
    }
    if (ch === "`") {
      k++;
      while (k < input.length && input[k] !== "`") {
        if (input[k] === "\\") {
          k += 2;
          continue;
        }
        if (input[k] === "$" && input[k + 1] === "{") {
          let td = 1;
          k += 2;
          while (k < input.length && td > 0) {
            const c = input[k];
            if (c === "{") td++;
            else if (c === "}") td--;
            if (td === 0) break;
            k++;
          }
          k++;
          continue;
        }
        k++;
      }
      k++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0) break;
    k++;
  }
  return k;
}

function expandJsxExpression(expr: string, registry: Registry, merge: boolean): string {
  let out = "";
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'") {
      const open = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== open) {
        if (expr[j] === "\\") j++;
        j++;
      }
      if (j >= expr.length) {
        // Unterminated string: no closing quote was found. Emit the rest
        // verbatim rather than expanding and appending a synthetic closer —
        // malformed input must pass through byte-identical.
        out += expr.slice(i);
        break;
      }
      const content = expr.slice(i + 1, j);
      // JS string-literal context (e.g. a cva()/tv() argument): keep the
      // original delimiter and escape the expansion for it, so a quote- or
      // backslash-bearing token can't break out or inject code.
      const expandedStr = expandClassList(content, registry, merge);
      out += open + escapeForStringLiteral(expandedStr, open as '"' | "'") + open;
      i = j + 1;
    } else if (ch === "`") {
      let j = i + 1;
      let result = "`";
      let staticBuf = "";
      const flush = (): void => {
        if (staticBuf.length === 0) return;
        if (!/\S/.test(staticBuf)) {
          result += staticBuf;
          staticBuf = "";
          return;
        }
        const leadWS = staticBuf.match(/^\s*/)?.[0] ?? "";
        const trailWS = staticBuf.match(/\s*$/)?.[0] ?? "";
        const middle = staticBuf.slice(leadWS.length, staticBuf.length - trailWS.length);
        // Template-literal context: escape so an expanded token can't terminate
        // the literal (backtick) or inject an interpolation (`${`).
        result += leadWS + escapeForTemplateLiteral(expandClassList(middle, registry, merge)) + trailWS;
        staticBuf = "";
      };
      while (j < expr.length && expr[j] !== "`") {
        if (expr[j] === "\\") {
          staticBuf += expr.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (expr[j] === "$" && expr[j + 1] === "{") {
          flush();
          result += "${";
          let depth = 1;
          let k = j + 2;
          while (k < expr.length && depth > 0) {
            const c = expr[k];
            if (c === "{") depth++;
            else if (c === "}") depth--;
            if (depth === 0) break;
            result += c;
            k++;
          }
          result += "}";
          j = k + 1;
          continue;
        }
        staticBuf += expr[j];
        j++;
      }
      flush();
      result += "`";
      out += result;
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
