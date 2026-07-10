---
title: Quickstart
description: Everything you need to go from nothing to a live URL — create an account, install the CLI, publish.
order: 1
product: cloud
---

# Quickstart

This is the whole path from nothing to a live page. You set up three things once
(an account, the CLI, and login), then publish with one command. You do **not**
need to set up recipes to publish a plain HTML file.

## Before you start

You need two things:

**1. A Shortwind account.** Go to
[shortwind.dev/cloud](https://shortwind.dev/cloud) and click **Start free**.
Publishing and serving are free; you only pay if you later bring a custom domain
(Pro, $5/mo).

**2. The CLI.** It ships as `@shortwind/cli` (beta). Install it into a project:

```bash
npm i -D @shortwind/cli@beta
```

The examples below use the installed `shortwind` command. To run without
installing, prefix any command with `npx @shortwind/cli@beta`, for example
`npx @shortwind/cli@beta cloud login`.

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

Any HTML file works. Make one:

```bash
echo '<h1>Hello from my agent</h1>' > hello.html
```

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

## Do I need recipes?

No. Recipes are optional. If your HTML uses `@recipe` shorthand (like
`class="@card"`), Cloud expands it to Tailwind server-side at publish time,
pulling from the recipe palette in your Shortwind home. Plain HTML publishes
as-is. See
[how recipes travel with a publish](/docs/cloud-publishing#how-recipes-travel-with-a-publish)
when you want to use them.

## Next

- [Publishing & versions](/docs/cloud-publishing): slugs, visibility, tags, and
  the version model in depth.
- [Custom domains](/docs/cloud-domains): serve pages on your own domain (Pro).
- [The agent API](/docs/cloud-api): drive publish and update over HTTP instead
  of the CLI.
