# Issue drafts

Each file in this directory is one GitHub issue. The filename prefix indicates the suggested order of execution, but issues can be picked up out-of-order if dependencies are met.

To create as GitHub issues once the repo is on GitHub:

```bash
for f in docs/issues/[0-9]*.md; do
  title=$(head -n1 "$f" | sed 's/^# //')
  body=$(tail -n +3 "$f")
  gh issue create --title "$title" --body "$body"
done
```

## Dependency order

1. **00-monorepo-bootstrap** — must be merged before anything else.
2. **01-core-parser, 02-core-resolver, 03-core-expander** — `@shortwind/core` foundation. Independent of each other once 00 lands, but block everything downstream.
3. **04-default-catalog** — depends on 01–03 (needs the recipe format finalized).
4. **05-cli-init, 06-cli-add-remove** — depend on 01–04.
5. **07-cli-build-watch, 08-skill-md-generator** — depend on 04.
6. **09-cli-upgrade** — depends on 05–06 and the fingerprint scheme.
7. **10-tailwind-adapter** — depends on 01–03; parallel to 05–09.
8. **11-vite-plugin, 12-next-plugin, 13-astro-plugin** — depend on 10.
9. **14-cdn-expander-build** — depends on 01–03.
10. **15-apps-web-shell, 16-catalog-page, 17-playground, 18-docs-route** — depend on 04, 14.
11. **19-registry-build-pipeline** — depends on 04, 15.
12. **20-cli-lint** — depends on 01–04.
13. **21-security-policy-ci** — independent.
