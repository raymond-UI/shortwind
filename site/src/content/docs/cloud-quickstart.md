---
title: Quickstart
description: Log in, publish an HTML file, and get a live URL in three commands.
order: 1
product: cloud
---

# Quickstart

This walks the happy path: authenticate, publish a file, and get back a live
URL. It assumes you have the CLI (`@shortwind/cli`, beta). Run it one-off with
`npx @shortwind/cli@beta cloud <verb>`, or install it and use the `shortwind`
command directly.

## 1. Log in

```bash
shortwind cloud login
```

This uses the OAuth device flow. The CLI prints a verification URL
(`shortwind.dev/cloud/device`) and a short code; open the URL in a browser,
enter the code, and approve the device. The CLI polls in the background and,
once approved, stores a token in your global Shortwind home and prints:

```
logged in as you@example.com (active account: acct_xxxxxxxxxxxx)
```

The token is machine-global, so you log in once per machine, not once per
project.

## 2. Publish a file

```bash
shortwind cloud publish ./launch.html
```

The CLI expands the `@recipe` classes in `launch.html` server-side, freezes the
result as version 1, and prints the live URL:

```
published https://launch-notes.shortwind.app
id: pg_xxxxxxxxxxxx
version: v1
```

Your page is now live at `<slug>.shortwind.app`. Serving is free and page views
are never billed.

Pick the slug yourself with `--domain`, and set who can see it with
`--visibility`:

```bash
shortwind cloud publish ./launch.html --domain launch-notes --visibility unlisted
```

## 3. Update it

Publishing is immutable: every publish or update is a new frozen version, and
old versions are retained. To ship a change to the **same URL**, update by page
id:

```bash
shortwind cloud update pg_xxxxxxxxxxxx ./launch.html
# published https://launch-notes.shortwind.app
# version: v2
```

## The find-then-publish pattern

The CLI is stateless: it never stores a page id, so your account is the only
memory. An agent that wants to "publish or update" first finds the page, then
chooses:

```bash
shortwind cloud find --tag launch --json
```

If `find` returns a matching page, `update <id>`; if not, `publish`. This is the
loop an agent runs to keep a page current without tracking ids itself.

## Next

- [Publishing & versions](/docs/cloud-publishing) for slugs, visibility, tags,
  and how recipes travel with a publish.
- [The agent API](/docs/cloud-api) if you are driving Cloud over HTTP instead of
  the CLI.
- [shortwind cloud CLI](/docs/cloud-cli) for every verb and flag.
