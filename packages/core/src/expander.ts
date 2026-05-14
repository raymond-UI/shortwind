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

export function expand(
  input: string,
  registry: Registry,
  options: ExpandOptions = {},
): string {
  const mode = options.mode ?? "html";
  const merge = options.mergeConflicts ?? true;

  let out = input;

  out = out.replace(
    /\bclass\s*=\s*"([^"]*)"/g,
    (_m, cls: string) => `class="${expandClassList(cls, registry, merge)}"`,
  );
  out = out.replace(
    /\bclass\s*=\s*'([^']*)'/g,
    (_m, cls: string) => `class='${expandClassList(cls, registry, merge)}'`,
  );

  if (mode === "jsx") {
    out = out.replace(
      /\bclassName\s*=\s*"([^"]*)"/g,
      (_m, cls: string) => `className="${expandClassList(cls, registry, merge)}"`,
    );
    out = out.replace(
      /\bclassName\s*=\s*'([^']*)'/g,
      (_m, cls: string) => `className='${expandClassList(cls, registry, merge)}'`,
    );
    out = expandJsxBraced(out, registry, merge);
    const callExpanders = options.callExpanders ?? DEFAULT_CALL_EXPANDERS_JSX;
    if (callExpanders.length > 0) {
      out = expandCallStringArgs(out, callExpanders, registry, merge);
    }
  } else if (options.callExpanders && options.callExpanders.length > 0) {
    out = expandCallStringArgs(out, options.callExpanders, registry, merge);
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
  for (const t of tokens) {
    if (t.startsWith("@")) {
      const expanded = registry.flattened[t.slice(1)];
      if (expanded) out.push(...expanded);
      else out.push(t);
    } else {
      out.push(t);
    }
  }
  const joined = out.join(" ");
  return mergeConflicts ? twMerge(joined) : joined;
}

const CLASSNAME_KW = "className";

// expandJsxBraced operates as a text rewriter, not a JS parser. Inside
// className={ ... } expressions it only rewrites string literals and
// template literals at the top level of the expression — it does not
// skip JS comments or regex literals. Code like
//   className={ /"/.test(x) ? "@foo" : "" }
// or
//   className={ /* @foo */ ... }
// is therefore *out of contract* — wrap such expressions in a helper or
// stick to literal strings / template literals at the top level.
function expandJsxBraced(input: string, registry: Registry, merge: boolean): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const idx = input.indexOf(CLASSNAME_KW, i);
    if (idx < 0) {
      out += input.slice(i);
      break;
    }
    const before = idx > 0 ? input[idx - 1] ?? "" : "";
    if (before && /[\w$]/.test(before)) {
      out += input.slice(i, idx + CLASSNAME_KW.length);
      i = idx + CLASSNAME_KW.length;
      continue;
    }
    let j = idx + CLASSNAME_KW.length;
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
  const escaped = callNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(?:${escaped.join("|")})\\s*\\(`, "g");
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const callStart = m.index;
    out += input.slice(cursor, callStart);
    const bodyStart = callStart + m[0].length;
    const bodyEnd = findCallBodyEnd(input, bodyStart);
    const body = input.slice(bodyStart, bodyEnd);
    out += m[0] + expandJsxExpression(body, registry, merge);
    if (bodyEnd < input.length) {
      out += ")";
      cursor = bodyEnd + 1;
      re.lastIndex = cursor;
    } else {
      cursor = bodyEnd;
      break;
    }
  }
  out += input.slice(cursor);
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
      const content = expr.slice(i + 1, j);
      out += open + expandClassList(content, registry, merge) + open;
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
        result += leadWS + expandClassList(middle, registry, merge) + trailWS;
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
