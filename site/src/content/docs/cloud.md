---
title: What is Cloud
description: How Shortwind Cloud relates to core Shortwind, and when to reach for it.
order: 0
product: cloud
---

# What is Cloud

Shortwind Cloud is agent-native HTML hosting. An agent (or you, from the CLI)
publishes one HTML file and gets a live URL back. There is no repo, no build
step, and no deploy config: the platform freezes the file as an immutable
version and serves it as static files from the edge.

It hosts **any** HTML, whether or not it uses Shortwind. If a page does use
`@recipe` shorthand, Cloud expands it to Tailwind server-side at publish time;
plain HTML is served exactly as written. And because identity lives in a
machine-global home, the `shortwind cloud` command runs from any directory, not
just inside a project.

> **Just want to publish something?** Skip to the
> [Quickstart](/docs/cloud-quickstart): create a free account, install the CLI,
> and publish an HTML file in three commands. This page is the concept tour.

## Core vs Cloud

They are two products, and Core is optional for Cloud: Cloud happily hosts plain
HTML and only touches recipes when a page has them. It is still worth being clear
about which one you are using.

| | **Core** | **Cloud** |
| --- | --- | --- |
| What it is | A build-time class layer you add to a project | A hosted service you publish pages to |
| How you install it | `npm i -D` into your project | `npm i -g` (or `npx`), run from any directory |
| Where it runs | Locally, in your bundler | On the edge, at publish time |
| You get | Plain Tailwind CSS in your build output | A live URL serving a frozen page |
| Needs recipes? | Yes; that is the whole point | No; recipes are optional |
| Auth | None; it is a local tool | An account and a device-flow token |
| Cost | Free and open source | Free to publish and serve; Pro for custom domains |

Everything under the **Core** tab in the sidebar is about writing and expanding
recipes in your own project. Everything under **Cloud** (these pages) is about
publishing and hosting.

## How they relate

If a page you publish uses recipes, Cloud runs the same `@shortwind/core`
expander you use locally, only it runs at publish time on our side. The CLI
uploads your HTML, your lockfile, and just the recipe families the page actually
touches; the server expands `@card` and friends into byte-identical Tailwind,
hashes the artifact, and stores it. Serving is then dumb static delivery, with no
runtime expansion and no origin compute per view.

So the recipes you author for Core are the recipes Cloud publishes with, when you
choose to use them. If a page references a recipe that is not present, that token
expands to nothing and goes out as raw text, so compose only from recipes you
actually have. Run [`shortwind cloud skill`](/docs/cloud-cli) to see the palette
available where you are publishing from. None of this applies to plain HTML,
which is served untouched.

## When to use Cloud

- Your agent needs to **publish a page and hand back a URL** in one step.
- You want a page to be **durable and versioned** without a Git repo.
- You want a viral page to **cost nothing to serve** (page views are never
  billed).
- You want to **bring your own domain** and have TLS handled for you (Pro).

If you are wiring Shortwind into an app you build and deploy yourself, you want
[Core](/docs). If you want us to host the output, you are in the right place.

## Next

- [Quickstart](/docs/cloud-quickstart): log in, publish a file, get a URL.
- [Publishing & versions](/docs/cloud-publishing): the immutable-version model,
  slugs, and visibility.
- [The agent API](/docs/cloud-api): the `v1` REST surface an agent drives.
