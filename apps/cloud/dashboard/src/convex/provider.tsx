import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useMutation, useAction, useConvexAuth } from "convex/react";
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
  const billing = useQuery(
    api.billingStripe.queries.summary,
    skip ? "skip" : args,
  );
  const accountDomains = useQuery(
    api.domains.listAccountDomains,
    skip ? "skip" : args,
  );
  const domainSetup = useQuery(
    api.domains.domainSetupInfo,
    skip ? "skip" : args,
  );
  const tokens = useQuery(api.dashboard.listTokens, skip ? "skip" : args);
  const setPolicyMutation = useMutation(api.dashboard.setAccountPolicy);
  const setVisibilityMutation = useMutation(api.pages.setVisibility);
  const deletePageMutation = useMutation(api.pages.deletePage);
  const revokeTokenMutation = useMutation(api.dashboard.revokeToken);
  const createCheckoutAction = useAction(
    api.billingStripe.actions.createCheckoutSession,
  );
  const portalUrlAction = useAction(api.billingStripe.actions.portalUrl);
  const approveDomainAction = useAction(api.domains.approveAccountDomain);
  const bindDomainAction = useAction(api.domains.bindAccountDomain);
  const recheckDomainAction = useAction(api.domains.recheckAccountDomain);
  const removeDomainAction = useAction(api.domains.removeAccountDomain);

  const value = useMemo<DashboardData>(
    () => ({
      pages,
      auditLog,
      recipeEdits,
      moderation,
      policy,
      usage,
      billing,
      accountDomains,
      cnameTarget: domainSetup?.cnameTarget,
      tokens,
      setPolicy: async (next) => {
        await setPolicyMutation(next);
      },
      setVisibility: async (id, visibility) => {
        // Bearer omitted → operator-session path (requireWriteOperator).
        await setVisibilityMutation({ id: id as never, visibility });
      },
      deletePage: async (id) => {
        await deletePageMutation({ id: id as never });
      },
      revokeToken: async (tokenId) => {
        await revokeTokenMutation({ tokenId: tokenId as never });
      },
      startCheckout: async (plan) => {
        // Bearer omitted → operator-session path (requireWriteOperator).
        return await createCheckoutAction({ plan });
      },
      openPortal: async () => {
        return await portalUrlAction({});
      },
      bindDomain: async (hostname) => {
        // Bearer omitted → operator-session path (the account owner binds).
        return await bindDomainAction({ hostname });
      },
      recheckDomain: async (hostname) => {
        return await recheckDomainAction({ hostname });
      },
      approveDomain: async (hostname) => {
        // Bearer omitted → operator-session path (requireReadOperator).
        await approveDomainAction({ hostname });
      },
      removeDomain: async (hostname) => {
        await removeDomainAction({ hostname });
      },
    }),
    [
      pages,
      auditLog,
      recipeEdits,
      moderation,
      policy,
      usage,
      billing,
      accountDomains,
      domainSetup,
      tokens,
      setPolicyMutation,
      setVisibilityMutation,
      deletePageMutation,
      revokeTokenMutation,
      createCheckoutAction,
      portalUrlAction,
      approveDomainAction,
      bindDomainAction,
      recheckDomainAction,
      removeDomainAction,
    ],
  );

  return <DashboardDataProvider value={value}>{children}</DashboardDataProvider>;
}
