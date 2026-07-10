---
title: What is Cloud
description: How Shortwind Cloud relates to core Shortwind, and when to reach for it.
order: 0
product: cloud
---

# What is Cloud

Shortwind Cloud is agent-native HTML hosting. An agent (or you, from the CLI)
publishes one HTML file and gets a live URL back. There is no repo, no build
step, and no deploy config: the platform expands your `@recipe` classes
server-side, freezes the result as an immutable version, and serves it as static
files from the edge.

## Core vs Cloud

They are two products that share one primitive (recipes), and it is worth being
clear about which one you are using.

| | **Core** (`@shortwind/cli`) | **Cloud** (`shortwind cloud`) |
| --- | --- | --- |
| What it is | A build-time class layer you install into your own project | A hosted service you publish pages to |
| Where it runs | Locally, in your bundler | On the edge, at publish time |
| You get | Plain Tailwind CSS in your build output | A live URL serving a frozen page |
| Ships to users | Nothing new (compiles to Tailwind) | The expanded HTML, served static |
| Auth | None; it is a local tool | An account and a device-flow token |
| Cost | Free and open source | Free to publish and serve; Pro for custom domains |

Everything under the **Core** tab in the sidebar is about writing and expanding
recipes in your own project. Everything under **Cloud** (these pages) is about
publishing and hosting.

## How they relate

Cloud runs the same `@shortwind/core` expander you use locally, only it runs at
publish time on our side. When you publish, the CLI uploads your HTML, your
lockfile, and just the recipe families your page actually touches. The server
expands `@card` and friends into byte-identical Tailwind, hashes the artifact,
and stores it. Serving is then dumb static delivery; there is no runtime
expansion and no origin compute per view.

That means the recipes you author for Core are the recipes Cloud publishes with.
If you compose a page from a recipe your account does not ship, it expands to
nothing and goes out as raw text. Run [`shortwind cloud skill`](/docs/cloud-cli)
to see the palette your account currently has.

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
