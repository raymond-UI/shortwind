import { useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { DashboardDataProvider } from "../lib/data";
import type { DashboardData } from "../lib/types";

/**
 * Live Convex data provider (CLOUD-35).
 *
 * Fills the `DashboardData` seam from `useQuery(api.dashboard.*)` — five
 * reactive queries + the one policy mutation. Because every dashboard query is a
 * plain Convex query, the whole UI re-renders the instant any underlying table
 * changes (PRD §6.3 reactivity). No polling.
 *
 * Bearer note (finalized in CLOUD-30b): the `api.dashboard.*` queries are guarded
 * by `requireRead`, which validates a read-scoped `swc_…` operator bearer from
 * the `tokens` table (NOT the Better Auth session directly). The dashboard reads
 * that operator bearer from `VITE_DASHBOARD_BEARER` for local/dev; CLOUD-30b
 * wires the deployed flow that mints a short-lived read bearer for the
 * authenticated operator from their Better Auth session. Until a Convex URL +
 * bearer are present, the queries simply stay in their loading state (the views
 * render their "Loading…" branch) — the build + component tests don't depend on
 * a live deployment.
 */
const BEARER = (import.meta.env.VITE_DASHBOARD_BEARER as string | undefined) ?? "";

export function ConvexDataProvider({ children }: { children: ReactNode }) {
  const args = { bearer: BEARER };

  // `skip` until a bearer is present — avoids firing guarded queries that would
  // 401 with no credential (e.g. an offline preview build).
  const skip = BEARER === "";

  const pages = useQuery(api.dashboard.listPages, skip ? "skip" : args);
  const auditLog = useQuery(api.dashboard.listAuditLog, skip ? "skip" : args);
  const recipeEdits = useQuery(
    api.dashboard.listRecipeEditEvents,
    skip ? "skip" : args,
  );
  const moderation = useQuery(
    api.dashboard.listModeration,
    skip ? "skip" : args,
  );
  const policy = useQuery(api.dashboard.getAccountPolicy, skip ? "skip" : args);
  const setPolicyMutation = useMutation(api.dashboard.setAccountPolicy);

  const value = useMemo<DashboardData>(
    () => ({
      pages,
      auditLog,
      recipeEdits,
      moderation,
      policy,
      setPolicy: async (next) => {
        await setPolicyMutation({ bearer: BEARER, ...next });
      },
    }),
    [pages, auditLog, recipeEdits, moderation, policy, setPolicyMutation],
  );

  return <DashboardDataProvider value={value}>{children}</DashboardDataProvider>;
}
