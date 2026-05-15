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
