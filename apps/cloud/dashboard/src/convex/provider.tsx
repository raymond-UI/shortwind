import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@convex/_generated/api";
import { DashboardDataProvider } from "../lib/data";
import type { DashboardData } from "../lib/types";

/**
 * Live Convex data provider (CLOUD-30b rebuild).
 *
 * Fills the `DashboardData` seam from the reactive oversight queries
 * (`api.dashboard.*` + `api.billing.getUsage`) — five reads + the policy
 * mutation. Every query is a plain Convex query, so the UI re-renders the
 * instant any underlying table changes (PRD §6.3). No polling.
 *
 * Auth: queries now authenticate with the logged-in Better Auth SESSION, not a
 * baked bearer. `requireReadOperator` resolves the operator's account from the
 * session. So:
 *   1. Wait for `useConvexAuth().isAuthenticated` (the Convex client has the
 *      session JWT).
 *   2. Call `ensureAccount` once — provisions the operator's `accounts` row on
 *      first sign-in (idempotent). Until it resolves, the session has no account
 *      and the guard would 401, so we `skip` the reads.
 *   3. Fire the reads with EMPTY args (the bearer is omitted → session path).
 */
export function ConvexDataProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const ensureAccount = useMutation(api.dashboard.ensureAccount);
  const [accountReady, setAccountReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setAccountReady(false);
      return;
    }
    let cancelled = false;
    void ensureAccount({})
      .then(() => {
        if (!cancelled) setAccountReady(true);
      })
      .catch(() => {
        // Leave the dashboard in its loading branch on a provisioning failure;
        // a router invalidate / reload retries.
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ensureAccount]);

  // Skip the guarded reads until the operator is authenticated AND their account
  // is provisioned (otherwise the session path 401s with `no_account`).
  const skip = !isAuthenticated || !accountReady;
  const args = {};

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
  const usage = useQuery(api.billing.getUsage, skip ? "skip" : args);
  const setPolicyMutation = useMutation(api.dashboard.setAccountPolicy);

  const value = useMemo<DashboardData>(
    () => ({
      pages,
      auditLog,
      recipeEdits,
      moderation,
      policy,
      usage,
      setPolicy: async (next) => {
        await setPolicyMutation(next);
      },
    }),
    [pages, auditLog, recipeEdits, moderation, policy, usage, setPolicyMutation],
  );

  return <DashboardDataProvider value={value}>{children}</DashboardDataProvider>;
}
