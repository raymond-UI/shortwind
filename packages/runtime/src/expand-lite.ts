import type { Registry } from "@shortwind/core";

export function expandClassList(classList: string, registry: Registry): string {
  const tokens = classList.split(/\s+/).filter(Boolean);
  if (!tokens.some((t) => t.charCodeAt(0) === 64)) return classList;
  const out: string[] = [];
  for (const t of tokens) {
    if (t.charCodeAt(0) === 64) {
      const expanded = registry.flattened[t.slice(1)];
      if (expanded) {
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
    const cls = el.getAttribute("class");
    if (cls === null) continue;
    const expanded = expandClassList(cls, registry);
    if (expanded !== cls) el.setAttribute("class", expanded);
  }
}
