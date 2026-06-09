import { parse, type ParserPlugin } from "@babel/parser";
import { expandClassList, type Registry } from "@shortwind/core";

export type JsxTransformOptions = {
  mergeConflicts: boolean;
  callExpanders: readonly string[];
};

type Replacement = {
  start: number;
  end: number;
  value: string;
};

type Node = { type: string; start?: number | null; end?: number | null } & Record<
  string,
  unknown
>;

const PLUGINS: ParserPlugin[] = ["jsx", "typescript"];

export function transformJsxContent(
  content: string,
  registry: Registry,
  options: JsxTransformOptions,
): string {
  let ast: Node;
  try {
    ast = parse(content, {
      sourceType: "module",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      plugins: PLUGINS,
    }) as unknown as Node;
  } catch {
    // Unparseable input is treated as opaque; HTML-mode callers shouldn't
    // reach here, and a hard syntax error in JSX is rare enough that
    // leaving the source untouched is safer than half-transforming it.
    return content;
  }

  const replacements: Replacement[] = [];
  const callExpanders = new Set(options.callExpanders);

  const pushStringReplacement = (node: Node): void => {
    const start = (node.start ?? 0) + 1;
    const end = (node.end ?? 0) - 1;
    if (start >= end) return;
    const raw = content.slice(start, end);
    const expanded = expandClassList(raw, registry, options.mergeConflicts);
    if (expanded !== raw) replacements.push({ start, end, value: expanded });
  };

  const pushTemplateReplacement = (node: Node): void => {
    const quasis = node["quasis"] as Node[] | undefined;
    if (!quasis) return;
    for (const quasi of quasis) {
      const start = quasi.start ?? 0;
      const end = quasi.end ?? 0;
      if (start >= end) continue;
      const raw = content.slice(start, end);
      if (!/\S/.test(raw)) continue;
      const leadWS = raw.match(/^\s*/)?.[0] ?? "";
      const trailWS = raw.match(/\s*$/)?.[0] ?? "";
      const middle = raw.slice(leadWS.length, raw.length - trailWS.length);
      const expanded = expandClassList(middle, registry, options.mergeConflicts);
      const next = leadWS + expanded + trailWS;
      if (next !== raw) replacements.push({ start, end, value: next });
    }
  };

  const collectClassStrings = (node: Node): void => {
    if (node.type === "StringLiteral") {
      pushStringReplacement(node);
      return;
    }
    if (node.type === "TemplateLiteral") {
      pushTemplateReplacement(node);
      return;
    }
    walkChildren(node, collectClassStrings);
  };

  const visit = (node: Node): void => {
    if (node.type === "JSXAttribute" && isClassAttribute(node)) {
      const value = node["value"] as Node | null | undefined;
      if (value) collectClassStrings(value);
      return;
    }
    if (node.type === "CallExpression" && isConfiguredCall(node, callExpanders)) {
      const args = (node["arguments"] as Node[] | undefined) ?? [];
      for (const arg of args) collectClassStrings(arg);
      return;
    }
    walkChildren(node, visit);
  };

  visit(ast);
  return applyReplacements(content, replacements);
}

function isClassAttribute(node: Node): boolean {
  const name = node["name"] as Node | undefined;
  if (!name) return false;
  // JSXAttribute.name is either JSXIdentifier ({type, name}) or
  // JSXNamespacedName (which `class`/`className` never are).
  const ident = name.type === "JSXIdentifier" ? (name["name"] as string) : "";
  return ident === "class" || ident === "className";
}

function isConfiguredCall(node: Node, callExpanders: Set<string>): boolean {
  const callee = node["callee"] as Node | undefined;
  if (!callee || callee.type !== "Identifier") return false;
  return callExpanders.has(callee["name"] as string);
}

// Babel doesn't ship a tiny visitor library separately, so we walk the AST
// manually. Every Node-typed child sits on a known property; we identify them
// by the `type` string and skip anything else (location info, raw text, etc.).
function walkChildren(node: Node, visit: (n: Node) => void): void {
  for (const key in node) {
    if (key === "loc" || key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) visit(item as Node);
      }
    } else if (isAstNode(value)) {
      visit(value as Node);
    }
  }
}

function isAstNode(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function applyReplacements(input: string, replacements: Replacement[]): string {
  if (replacements.length === 0) return input;
  const sorted = replacements
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue;
    out += input.slice(cursor, r.start) + r.value;
    cursor = r.end;
  }
  return out + input.slice(cursor);
}
