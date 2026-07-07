/**
 * Billing scope.
 *
 * Ported from Realm's `convex/billing/scope.ts`, but re-based onto Shortwind
 * Cloud's subject model: Realm bills an *organization*; Shortwind Cloud bills
 * an **account** (`accounts` table — the same subject `requireReadOperator` /
 * `requireWriteOperator` resolve, and the one every meter in `billing.ts` is
 * keyed to). So the scope carries an `accountId`, not an `orgId`.
 *
 * The `@convex-dev/stripe` component keys its customer/subscription rows by an
 * opaque string it happens to call `userId` / `orgId`; it does not care what
 * the value means. `customerKey` is the single place that maps our scope onto
 * that opaque field, so feature code never has to know the linkage.
 *
 * If user-scoped billing is ever added alongside account-scoped billing, this
 * becomes a discriminated union and `customerKey` namespaces with an
 * `account:` / `user:` prefix to avoid collision in the component's key column.
 */
export type BillingScope = { type: "account"; accountId: string };

/**
 * The opaque id handed to the Stripe component as its customer key. The
 * account id IS the linkage — we do not maintain a separate mapping table
 * (the component already indexes customers by this value).
 */
export function customerKey(scope: BillingScope): string {
  return scope.accountId;
}
