import type { Registry } from "@shortwind/core";

// 64 = "@".charCodeAt(0). We compare char codes instead of `startsWith("@")`
// because this is the per-token hot path in the DOM walk and the lookup runs
// before we know whether expansion is needed.
const AT_CHAR_CODE = 64;

export function expandClassList(classList: string, registry: Registry): string {
  const tokens = classList.split(/\s+/).filter(Boolean);
  if (!tokens.some((t) => t.charCodeAt(0) === AT_CHAR_CODE)) return classList;
  const out: string[] = [];
  for (const t of tokens) {
    if (t.charCodeAt(0) === AT_CHAR_CODE) {
      const name = t.slice(1);
      // `Object.hasOwn` + array check, never a bare truthy lookup: a class like
      // `@constructor` in page content (CMS/markdown that survives sanitization)
      // would otherwise resolve an inherited `Object.prototype` member and throw
      // mid-walk, DoSing expansion for the whole page.
      const expanded = Object.hasOwn(registry.flattened, name)
        ? registry.flattened[name]
        : undefined;
      if (Array.isArray(expanded)) {
        for (const e of expanded) out.push(e);
        continue;
      }
    }
    out.push(t);
  }
  return out.join(" ");
}

export function expandDOM(root: Element, registry: Registry): void {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    // Isolate each element: a malformed attribute on one node must not abort
    // the walk and leave the rest of the page unexpanded.
    try {
      const cls = el.getAttribute("class");
      if (cls === null) continue;
      const expanded = expandClassList(cls, registry);
      if (expanded !== cls) el.setAttribute("class", expanded);
    } catch {
      // skip this element; continue expanding the rest of the document
    }
  }
}
