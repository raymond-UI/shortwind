---
title: Custom domains
description: Bind an account-level custom domain on Pro; every page then serves at your-domain/<slug>.
order: 3
product: cloud
---

# Custom domains

On the **Pro** plan ($5/mo) you can bind a custom domain to your account. A
bound domain is an account-wide alias: once it is active, every page you host
also serves at `your-domain/<slug>`, with a TLS certificate issued for you.
Domains bind to the **account**, not to a single page.

## Bind a domain

```bash
shortwind cloud bind-domain pages.example.com
```

Binding requires the `domains:bind` scope, which your login token does not carry
by default. The CLI detects this and re-runs the device-flow login to request
the elevated scope for this one operation; the elevated scope is used for the
bind and is not persisted into your stored credential.

## Bind lifecycle

A bind moves through these states, reported on each `bind-domain` /
`approve-domain` call and by `domains`:

```
pending-human -> queued <-> pending-cert -> active
                                          -> failed
```

- **pending-human**: waiting on an operator/human approval gate.
- **queued** / **pending-cert**: provisioning and certificate issuance.
- **active**: live; pages now serve at `your-domain/<slug>`.
- **failed**: provisioning did not complete (the result carries a reason).

## Approve a pending domain

A domain sitting at `pending-human` is released with:

```bash
shortwind cloud approve-domain pages.example.com
```

## List your domains

```bash
shortwind cloud domains
# pages.example.com   active
```

Add `--json` for machine-readable output, the same as every other verb.
