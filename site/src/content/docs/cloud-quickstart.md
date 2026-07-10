---
title: Quickstart
description: Everything you need to go from nothing to a live URL — create an account, install the CLI, publish.
order: 1
product: cloud
---

# Quickstart

This is the whole path from nothing to a live page. You set up three things once
(an account, the CLI, and login), then publish with one command. Cloud hosts
**any** HTML file: you do not need to write it with Shortwind, and you do not
need to be inside a project.

## Before you start

You need two things:

**1. A Shortwind account.** Go to
[shortwind.dev/cloud](https://shortwind.dev/cloud) and click **Start free**.
Publishing and serving are free; you only pay if you later bring a custom domain
(Pro, $5/mo).

**2. The CLI.** Cloud is driven by the `@shortwind/cli` package (beta). Unlike
the [Core tooling](/docs/install), which lives inside a project as a dev
dependency, `shortwind cloud` is a standalone command you run from any
directory. Install it globally:

```bash
npm i -g @shortwind/cli@beta
```

Or skip the install and run it on demand with `npx @shortwind/cli@beta cloud
<verb>`. Either way it behaves the same from anywhere; your login is stored
under `~/.shortwind/`, not in the current folder. The examples below use the
`shortwind` command.

## 1. Log in

```bash
shortwind cloud login
```

This links your machine to your account with the OAuth device flow. The CLI
prints a short code and a URL (`shortwind.dev/cloud/device`); open the URL in the
browser where you signed up, enter the code, and approve. Your token is then
stored under `~/.shortwind/` and you will not have to log in again on this
machine:

```
logged in as you@example.com (active account: acct_xxxxxxxxxxxx)
```

There is no separate init step. `login` creates the local home for you.

## 2. Publish a page

Any HTML file works, from any directory. Make one:

```bash
echo '<h1>Hello from my agent</h1>' > hello.html
```

That is ordinary HTML with no Shortwind in it, and that is fine. Cloud hosts the
file as-is.

Publish it:

```bash
shortwind cloud publish hello.html
```

You get a live URL back:

```
published https://<slug>.shortwind.app
id: pg_xxxxxxxxxxxx
version: v1
```

Open the URL: your page is live, served free from the edge. Choose the slug and
who can see it with `--domain` and `--visibility`:

```bash
shortwind cloud publish hello.html --domain my-first-page --visibility public
```

## 3. Change it

To ship an edit to the **same URL**, update the page by its id (from the publish
output above, or from `shortwind cloud find`):

```bash
shortwind cloud update pg_xxxxxxxxxxxx hello.html
# published https://my-first-page.shortwind.app
# version: v2
```

That is the core loop: `publish` once to create a page, `update` to revise it.
Every publish and update is a new immutable version; nothing is overwritten.

## Do I need Shortwind recipes?

No. Cloud hosts any HTML file; recipes are an optional convenience for people who
already author with [Core](/docs). If a page you publish uses `@recipe` shorthand
(like `class="@card"`) **and** you run `publish` from inside a project that has a
`recipes/` directory, Cloud expands that shorthand to Tailwind server-side at
publish time. Everything else, including plain HTML, is served exactly as
written. See
[how recipes travel with a publish](/docs/cloud-publishing#how-recipes-travel-with-a-publish)
for the details.

## Next

- [Publishing & versions](/docs/cloud-publishing): slugs, visibility, tags, and
  the version model in depth.
- [Custom domains](/docs/cloud-domains): serve pages on your own domain (Pro).
- [The agent API](/docs/cloud-api): drive publish and update over HTTP instead
  of the CLI.
