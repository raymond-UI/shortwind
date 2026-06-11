import { expandClassList } from "@shortwind/core";
import { loadCatalog } from "./catalog-data";

const { registry } = loadCatalog();

// Build-time resolve of a recipe class list to its raw Tailwind classes. Use
// this for *dynamic* class bindings — `class={cond ? rc("@a") : rc("@b")}` —
// which the build-time html transform can't reach inside a `{...}` expression.
// Static `class="@recipe"` attributes are expanded by the Shortwind plugin and
// don't need this.
export function rc(classList: string): string {
  return expandClassList(classList, registry, true);
}
