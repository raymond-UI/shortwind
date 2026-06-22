# CLOUD-02 — Phase-0 de-risking spike: does `expand()` run in a Worker?

## Outcome: **Worker-OK**

`@shortwind/core`'s `expand()` (and the `parseRecipeFile` → `buildRegistry`
pipeline it consumes) runs **cleanly inside the Cloudflare Workers (workerd)
runtime**, and produces output **byte-identical** to the same call under Node.

- **`nodejs_compat` needed?** **No.** Neither `worker/wrangler.toml` nor
  `worker/vitest.config.ts` sets `nodejs_compat` / `compatibility_flags`. The
  hypothesis from the repo `CLAUDE.md` ("core has zero workspace deps and zero
  Node built-ins") held: core imports only `tailwind-merge`, which is likewise
  pure JS. No Node built-in (`node:fs`, `node:path`, `Buffer`, …) is touched on
  the expand path.
- **Runtime verified:** the test executes under workerd via
  `@cloudflare/vitest-pool-workers@0.16.18` (not the Node pool), against a fixed
  recipe set (`button.css` + `card.css`, byte-faithful to `site/recipes/`).
- **Parity asserted:** the workerd output is compared `===` to a golden string
  computed in Node v24 from the identical pipeline + inputs, plus a `.length`
  check so trailing-whitespace/encoding drift can't slip past. `tailwind-merge`
  is exercised too (`@btn-primary-sm` correctly drops the base `px-4 py-2
  text-sm` it conflicts with) — proving core's only runtime dependency also
  executes under workerd.

### Test output (binary evidence)

```
 RUN  v4.1.4  apps/cloud
 ✓ worker/test/expand-edge.test.ts > CLOUD-02 spike: @shortwind/core expand() under workerd > imports and runs the full parse → resolve → expand pipeline in workerd
 ✓ worker/test/expand-edge.test.ts > CLOUD-02 spike: @shortwind/core expand() under workerd > produces output byte-identical to the Node reference (expand parity)
 ✓ worker/test/expand-edge.test.ts > CLOUD-02 spike: @shortwind/core expand() under workerd > exercises tailwind-merge: @btn-primary-sm drops the base px-4/py-2/text-sm

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Reproduce:

```
pnpm -C apps/cloud install
pnpm -C apps/cloud exec vitest run --config worker/vitest.config.ts
```

### Tooling note (not a core finding)

`@cloudflare/vitest-pool-workers@0.16.18` (the version pinned in
`apps/cloud/package.json`, built for Vitest 4) does **not** ship the older
`defineWorkersConfig` helper or a `./config` export subpath. In this version the
workerd pool is installed as a **Vite plugin** via `cloudflareTest({...})`, which
sets up the pool and accepts the same `{ miniflare, wrangler }` options that used
to live under `poolOptions.workers`. `worker/vitest.config.ts` uses that form.
This is purely a test-harness wiring detail; it has no bearing on whether `core`
runs under workerd (it does).

## Production decision (this is the part that gates CLOUD-22)

**Expansion happens server-side at publish, via the Convex action (CLOUD-20).**
**The Worker serve path never expands.** Sites are stored already-expanded;
the Worker's job at request time is to serve static, pre-expanded HTML — not to
run the engine per request.

This spike does **not** change that. `worker/src/expand-edge.ts` is a spike-only
module and a stub `fetch` handler; it is **not** wired into the live serve path.

### Implication for CLOUD-22

CLOUD-22 (the Worker serve path) can proceed on the settled assumption that **it
does not need to expand** — publish-time expansion (CLOUD-20) is the source of
truth. Because this spike proves `expand()` *can* run under workerd with no
`nodejs_compat` and full byte-parity, **edge expansion is unblocked as a future
optimization** (e.g. on-the-fly expansion / live preview / cache-miss
regeneration) should a real need arise — but it is explicitly **out of scope for
the v1 serve path** and must not be adopted speculatively. The risk row in PRD
§9 ("Shortwind expander runs in Workers — Low") is now **retired: confirmed
low**.
