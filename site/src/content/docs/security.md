---
title: Security
description: Shortwind's security posture.
order: 9
---

# Security

## Trust boundary

Shortwind is a build-time tool. Recipe files are source code — review them
like you review any dependency. The runtime expander accepts a registry from
a `data-registry="<url>"` attribute; that URL is trusted as much as any other
remote script.

## Supply chain

- The default catalog ships inside `@shortwind/runtime` and inside the CLI
  binary. No remote fetch at install time.
- The CDN expander served from `shortwind.dev` is built from the same source
  as the npm package. The `expand@<semver>.js` URL is immutable; the
  unversioned `expand.js` follows latest.
- The CLI verifies recipe integrity at every step. `shortwind verify` is a
  read-only audit safe to wire into CI.

## Reporting issues

Please use private vulnerability disclosure on GitHub. The advisory will be
acknowledged within 48 hours.
