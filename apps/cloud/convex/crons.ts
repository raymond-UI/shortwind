import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * CLOUD-51 — scheduled jobs (PRD §10 Phase 3 optional).
 *
 * The single registered job sweeps EXPIRED pages: any page whose `expiresAt`
 * (the additive field added on the `pages` table) is due and that is still
 * `active` is TOMBSTONED via the same CLOUD-31/32 `applyLifecycle('delete')`
 * path a user delete uses — a tombstone, NOT a hard delete (the page record +
 * every version row are retained, PRD §8.2), plus the edge-route eviction so the
 * expired page stops serving on the hot path. The actual sweep logic lives in
 * `pages.sweepExpired` (it needs `ctx.db` + the pages-module edge port); this
 * file is only the schedule registration.
 *
 * Cadence: hourly. Expiry is a soft "no later than" guarantee (a page expires
 * within the hour after its `expiresAt`), which is the right resolution for a
 * hosting-expiry feature — the same convention the reference Convex crons use
 * for their periodic cleanups. A finer cadence is a one-line change here.
 */
const crons = cronJobs();

crons.interval(
  "tombstone expired pages",
  { hours: 1 },
  internal.pages.sweepExpired,
  {},
);

// Audit #158: honor the CSAM/abuse legal preservation window. Cases whose
// `preservationExpiresAt` has elapsed are audited (so an operator can action the
// now-permitted cleanup) and their hold marker cleared. Never auto-deletes the
// sealed evidence — see moderation.sweepPreservation.
crons.interval(
  "sweep elapsed preservation windows",
  { hours: 1 },
  internal.moderation.sweepPreservation,
  {},
);

export default crons;
