# Trust & Safety — abuse intake, kill path, preservation (CLOUD-32)

This document covers the trust-and-safety surface Shortwind Cloud ships at
launch, as mandated by PRD §8. Public, persistent, agent-generated pages carry
real legal liability; this surface is **non-optional** and ships at launch, not
after.

The implementation extends the CLOUD-31 page lifecycle state machine
(`convex/moderation.ts`). It never hard-deletes reported material: "delete for
abuse" means **quarantine to a sealed store**, distinct from an ordinary
tombstone.

## 1. Two orthogonal axes (recap)

| Axis | Field | Values |
| --- | --- | --- |
| Page disposition | `pages.lifecycle` | `active` \| `quarantined` \| `tombstoned` |
| T&S case | `moderation.state` | `reported` \| `quarantined` \| `preserved` \| `cleared` |

`tombstoned` (ordinary user delete) and `quarantined` (abuse kill) are **mutually
exclusive** lifecycle states reached by distinct transitions. A quarantined page
is excluded from `find` (unreachable) but `get` still returns its metadata for
audit.

## 2. Abuse-report intake (PRD §8.2)

The **reachable, monitored** abuse-report endpoint. This is the address NCMEC
CyberTipline reporting flows through.

```
POST /v1/abuse
Content-Type: application/json

{
  "pageId": "<page id>",
  "reason": "free-text description",
  "category": "csam" | "phishing" | "malware" | "other",   // optional, default "other"
  "reporterContact": "email-or-handle"                       // optional
}
```

- **No authentication.** Anyone can report. (Rate limiting at the edge / per-IP
  is wired in CLOUD-33; the handler is shaped to be rate-limit-friendly — it does
  one mutation and no fan-out.)
- Maps to `moderation.reportAbuse`, which opens (or refreshes) a single
  `reported` case for the page and writes a `page.abuse.report` audit entry.
- **A report does NOT pull the page.** Reporting establishes a case; an operator
  or the content classifier (CLOUD-33) decides whether to kill.
- Responses: `202` `{ "state": "reported" }`; `400` on a missing
  `pageId`/`reason`; `404` for an unknown page.

> **Operational requirement (CLOUD-30b):** this endpoint must be **monitored** —
> reports (especially `category: "csam"`) must reach a human/automation that can
> file the NCMEC report within the legal window. The endpoint is the technical
> half; the monitored-address obligation is operational.

## 3. Fast global kill (PRD §8.2 / §8.4)

`moderation.killPage` — the fast global kill. Requires a `pages:write` token
(operator/admin). In **one transaction**:

1. `applyLifecycle('quarantine')`: `active → quarantined`, the R2 object is
   **sealed** (its sealed-store key — `quarantine/<artifactKey>` — is recorded),
   **never hard-deleted**;
2. the sealed key is persisted on `moderation.preservedR2Key`
   (preserve-not-delete);
3. for `category: "csam"`: `moderation.preservationExpiresAt = now + 60 days`
   and `moderation.ncmecReportId` is recorded (if supplied);
4. the edge cache is purged and the KV route evicted via the `KillEdgePort`
   seam, so the page stops resolving on the hot path "in seconds";
5. the transition is audited (`page.quarantine`).

The frozen-static design makes this clean — **one object, one cache key**.

`phishing` and `malware` (PRD §8.4) ride the **same** kill path; they seal +
preserve but carry no NCMEC preservation clock.

```
killPage({ bearer, pageId, reason, category, ncmecReportId? })
  → { lifecycle: "quarantined", preservedR2Key: "quarantine/…" }
```

### Preserve-not-delete invariant

A quarantined/preserved object is **never hard-deleted**. The page row and every
`pageVersions` row (the R2 object pointers) are retained; only the public route
is killed. This is enforced structurally in the pure `transition` function
(`hardDeletes` is a compile-time `false` on every branch) and asserted in
`moderation.kill.test.ts`.

## 4. CSAM / NCMEC preservation (PRD §8.1)

Under 18 U.S.C. § 2258A (as expanded by the REPORT Act), a provider with actual
knowledge of apparent child-exploitation material must report to NCMEC's
CyberTipline as soon as possible and **no later than 60 days**, and must
**preserve** the material and related data.

- A `csam` kill stamps `moderation.preservationExpiresAt = now +
  PRESERVATION_WINDOW_MS` (`PRESERVATION_WINDOW_MS = 60 days`) and records the
  `moderation.ncmecReportId`.
- The sealed object is **retained** at `moderation.preservedR2Key` for the
  window. A preservation sweep that honours the clock (does not purge before
  `preservationExpiresAt`) is wired with the real object store in CLOUD-30b.
- The actual NCMEC CyberTipline filing is an operational/automation step driven
  off the monitored intake (§2).

## 5. Notice-and-takedown (PRD §8.3)

The same intake + kill path serves notice-and-takedown: a `category: "other"`
report (e.g. a copyright/DMCA or defamation notice) opens a case; an operator
kills via `killPage`. Building this first-class now is cheap insurance against
pending legislation (STOP CSAM Act) trending toward mandatory notice-and-takedown.

## 6. Proactive hash-matching seam (PRD §8.2 → CLOUD-33)

PRD §8.2 calls for **proactive hash-matching against known-CSAM lists**, to move
from reactive (actual-knowledge-only) to a defensible posture as volume grows.

The seam is left in `convex/moderation.ts` (search `CONTENT HASH-MATCHING SEAM`):

- **CLOUD-33** hooks the **publish path** — it hashes the candidate artifact,
  matches against the known-CSAM hash list, and on a hit calls `killPage` with
  `category: "csam"` (and files the NCMEC report). CLOUD-33 also adds the
  publish-time content classifier (reusing prior probabilistic
  prompt-injection / content-scoring work) and per-account rate limits.
- This issue (CLOUD-32) deliberately leaves hash-matching as a documented seam
  with no behavior; CLOUD-33 owns the hash-list integration.

## 7. What CLOUD-30b must wire (deploy)

- The real `KillEdgePort` — Cloudflare cache purge + KV route delete (the offline
  port is a no-op).
- The real R2 object **move/seal** to `quarantine/<artifactKey>` (currently the
  sealed-store key is recorded; the physical move lands at deploy).
- **Monitoring** of `POST /v1/abuse` so reports reach a human/automation, and the
  preservation sweep that honours `preservationExpiresAt`.
- The public origin env (`PAGES_BASE_URL`) for the purge URL.
