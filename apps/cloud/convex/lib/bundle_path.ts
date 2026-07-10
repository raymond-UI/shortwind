/**
 * Pure bundle-path helpers, shared by the bundle publish pipeline (`bundles.ts`)
 * and the serve-path resolver (`serve.ts`). No Convex types — plain string math
 * so both a mutation-time write and a query-time resolve agree byte-for-byte on
 * how an authored bundle-relative path normalizes.
 *
 * A bundle is an entry page plus sibling sub-pages served at their AUTHORED
 * paths on the entry's subdomain (`<subdomain>.shortwind.app/<path>`). Because
 * the served path mirrors the authored path, a browser resolves the author's
 * ordinary relative links (`<a href="about.html">`) correctly with no
 * link-rewriting — these helpers only canonicalize paths for storage keys and
 * for matching an incoming request path to a stored sibling.
 */

/** Normalize a bundle-relative path to a canonical POSIX form (no `./`, no `..`). */
export function normalizeBundlePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Normalize an incoming serve REQUEST path to the canonical bundle-relative form
 * used as a `bundleVersions.files[].path` key. Strips the leading slash and any
 * query/fragment, then applies {@link normalizeBundlePath}. The domain root
 * (`/` or empty) normalizes to `""` — the entry, not a sibling.
 */
export function normalizeServePath(path: string): string {
  const noSuffix = path.replace(/[?#].*$/, "");
  return normalizeBundlePath(noSuffix.replace(/^\/+/, ""));
}
