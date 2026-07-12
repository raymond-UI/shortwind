# Shortwind Cloud — Operations Runbook

Operational procedures for running Shortwind Cloud in production. Companion to
`DEPLOY.md` (provisioning). Covers observability, backup/disaster-recovery, and
secrets rotation. Tracks issue #202.

> Status legend: **[wired]** implemented in code and active once its env is set;
> **[manual]** an operator procedure; **[todo]** needs external provisioning or a
> product/legal decision before it can be completed.

---

## 1. Observability & alerting

### Structured logging **[wired]**
All must-never-be-silent failures emit a structured JSON line via
`convex/lib/ops_alert.ts` `logOps(level, event, fields)` — stable keys
(`sw_ops`, `level`, `event`) so a log aggregator can select them. Convex streams
function logs to its dashboard and to any configured
[Log Streams](https://docs.convex.dev/production/integrations/log-streams)
(Datadog / Axiom / a webhook). **[manual]** Point a log stream at your aggregator.

### Alerting on critical failures **[wired]**
`alertOps(event, fields)` logs the error AND, when `OPS_ALERT_WEBHOOK_URL` is set,
POSTs to an ops webhook (Slack/Discord/PagerDuty-compatible). Currently wired to:

| Event | Meaning | Action |
|-------|---------|--------|
| `r2_seal.failed` | A quarantined artifact was not moved to the sealed prefix | Manually seal + verify the object is unreachable |
| `ncmec.report_not_filed` | A CSAM CyberTipline report was not filed (unconfigured or failed) | File manually within the 60-day §2258A window |

The same `alertOps` seam is the place to add KV-eviction and cert-issuance
failure alerts, and to swap in a hosted error tracker (Sentry DSN) — call sites
don't change.

**Set:** `npx convex env set OPS_ALERT_WEBHOOK_URL https://…`

### Uptime / latency **[todo]**
Add an external uptime check against a public page and the `/v1/pages` API, plus
Cloudflare Worker analytics for the serve path. Needs a monitoring provider.

---

## 2. Backup & disaster recovery

### Control plane (Convex) **[manual]**
Convex is the system of record (accounts, pages, versions, tokens, moderation).
- **Backups:** enable [Convex backups](https://docs.convex.dev/production/backups)
  (daily snapshots) on the production deployment. Verify a snapshot exists before
  each risky migration.
- **Export:** `npx convex export --path backup-YYYYMMDD.zip` for an off-Convex
  copy; store encrypted in R2/S3 with a retention of ≥ 30 days.
- **Restore:** `npx convex import --replace backup.zip` into a recovery
  deployment; re-point `SHORTWIND_CLOUD_API` / the api-proxy after validation.

### Artifacts (R2) **[manual]**
Published HTML artifacts + sealed (quarantined) objects live in the R2 bucket.
- Enable R2 bucket versioning + a lifecycle rule that never expires the
  `quarantine/` prefix (legal hold).
- Configure R2 → R2 (or R2 → S3) replication to a second region/account for DR.
- The `quarantine/` prefix is legal-hold data — DR copies inherit the hold.

### Recovery objectives **[todo]**
Document target RPO/RTO once backup cadence + replication are provisioned.

---

## 3. Secrets rotation

All secrets live as Convex env vars (`npx convex env set`) + the api-proxy Worker
secrets — none are committed (audit #151 confirmed). Rotate on a schedule and
immediately on suspected exposure.

| Secret | Rotate | Procedure |
|--------|--------|-----------|
| `CLOUDFLARE_API_TOKEN` | 90d / on exposure | Mint a new scoped token (Custom Hostnames + SSL edit, Cache Purge, Workers KV edit), `convex env set`, revoke the old token in Cloudflare |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | 90d / on exposure | Create a new R2 S3 token, `convex env set` both, delete the old token |
| `SERVE_INTERNAL_SECRET` | on exposure | `convex env set` a new value AND update the serve Worker's binding in the same change window (both sides must match) |
| `STRIPE_*` | per Stripe guidance | Roll in the Stripe dashboard, `convex env set`, re-verify the webhook signing secret |
| `OPS_ALERT_WEBHOOK_URL` / `ABUSE_WEBHOOK_URL` | on exposure | Re-issue the incoming webhook, `convex env set` |
| `NCMEC_ESP_CREDENTIAL` | per NCMEC guidance | Rotate via the NCMEC ESP portal, `convex env set` |

**Kill switch:** revoking a leaked *user* bearer is `dashboard.revokeToken`
(operator-gated) or, for a whole account, `account_lifecycle.closeAccount`
(revokes every access + refresh token). The short access-token TTL (#201) bounds
the exposure of a leaked access token to ~1h even without an explicit revoke.

---

## 4. Data lifecycle (GDPR / CCPA)

- **Portability / SAR:** `account_lifecycle.exportAccountData` returns the
  account's full data bundle. **[wired]**
- **Erasure / closure:** `account_lifecycle.closeAccount` revokes all credentials
  and tombstones active pages, while PRESERVING quarantined/preserved material +
  moderation cases (the §8.2 legal hold survives an erasure request). **[wired]**
- **Full row-level purge** of non-held data (recipes, themes, domains, audit) on
  a retention schedule, reconciled with the legal hold, is a follow-up. **[todo]**

---

## 5. Legal surface **[todo]**

Requires counsel, not code. Tracked here so it isn't lost:
- Terms of Service, Acceptable Use Policy, Privacy Policy (public pages + linked
  from signup).
- DMCA registered agent + a public notice-and-takedown address (the technical
  intake — `POST /v1/abuse` + operator `killPage` — is wired; the registration
  and monitored address are not).
- The abuse intake is now monitored via `ABUSE_WEBHOOK_URL` (#198 item 3).
