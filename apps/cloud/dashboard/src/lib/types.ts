/**
 * Serializable shapes the dashboard renders. These mirror the `returns`
 * validators in `apps/cloud/convex/dashboard.ts` exactly (CLOUD-35) and are the
 * single source of truth the React views are typed against. Keeping a local
 * mirror (rather than importing Convex's generated `Doc` types) keeps the view
 * layer free of any Convex runtime import, so component tests can render with
 * plain fixture objects and never touch a live deployment.
 *
 * If a `dashboard.ts` validator changes, change it here too — the shapes are a
 * byte-for-byte contract.
 */

export type Visibility = "public" | "unlisted" | "private";
export type Lifecycle = "active" | "quarantined" | "tombstoned";
export type ModerationState =
  | "reported"
  | "quarantined"
  | "preserved"
  | "cleared";

export interface PageRow {
  id: string;
  slug: string;
  visibility: Visibility;
  lifecycle: Lifecycle;
  tags: string[];
  currentVersion: number;
  updatedAt: number;
  createdAt: number;
}

export interface PageVersionRow {
  id: string;
  version: number;
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
  createdAt: number;
}

export interface PageWithVersions {
  page: PageRow;
  versions: PageVersionRow[];
}

export interface AuditRow {
  id: string;
  action: string;
  targetId: string | null;
  actorTokenId: string | null;
  metadata: unknown;
  createdAt: number;
}

export interface RecipeEditRow {
  id: string;
  family: string;
  fromVersion: string | null;
  toVersion: string;
  bodySha: string;
  actorTokenId: string | null;
  createdAt: number;
  affectedPages: number;
}

export interface ModerationRow {
  id: string;
  pageId: string;
  state: ModerationState;
  reason: string | null;
  reporterContact: string | null;
  ncmecReportId: string | null;
  preservedR2Key: string | null;
  preservationExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AccountPolicy {
  customDomainNeedsApproval: boolean;
  updatedAt: number | null;
}

/** A scoped API token (hash omitted). Mirrors `dashboard.listTokens` returns. */
export interface TokenRow {
  tokenId: string;
  scopes: string[];
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
  expiresAt: number | null;
}

/**
 * The metered-billing usage the dashboard renders (CLOUD-43). Mirrors the
 * `getUsage` `returns` validator in `convex/billing.ts` exactly. The three
 * meters track what COSTS money per PRD §6.4 — publishes, custom domains,
 * storage — not page views (a viral page adds zero).
 */
export interface UsageMeters {
  publishes: number;
  customDomains: number;
  storageBytes: number;
  periodStart: number | null;
  periodEnd: number;
}

/** The plan ids the dashboard gates on. Mirrors `convex/lib/billing_plans.ts`. */
export type PlanId = "free" | "pro";

export type DomainStatus =
  | "pending-human"
  | "queued"
  | "pending-cert"
  | "active"
  | "failed";

/**
 * An ACCOUNT-level custom domain. Mirrors `domains.listAccountDomains` returns.
 * A domain is an account alias — every page serves at `<hostname>/<slug>`.
 */
export interface AccountDomainRow {
  id: string;
  hostname: string;
  status: DomainStatus;
  verifiedAt: number | null;
  createdAt: number;
}

/** The bind-state result of `bindAccountDomain` / `approveAccountDomain`. */
export interface DomainBindResult {
  state: DomainStatus;
  hostname: string;
  cloudflareHostnameId: string | null;
  reason?: string;
}

/**
 * The account's billing summary. Mirrors the `summary` query returns in
 * `convex/billingStripe/queries.ts`. `currentPeriodEnd` is Stripe's unix-seconds
 * period end (null when there is no active subscription).
 */
export interface BillingSummary {
  plan: PlanId;
  hasActive: boolean;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * The full oversight dataset the dashboard consumes. The real provider fills
 * each field from a `useQuery(api.dashboard.*)`; tests fill it with fixtures.
 * `undefined` means "still loading" (Convex's loading sentinel).
 */
export interface DashboardData {
  pages: PageWithVersions[] | undefined;
  auditLog: AuditRow[] | undefined;
  recipeEdits: RecipeEditRow[] | undefined;
  moderation: ModerationRow[] | undefined;
  policy: AccountPolicy | undefined;
  /** Metered billing usage (CLOUD-43): the three cost-aligned meters. */
  usage: UsageMeters | undefined;
  /** The account's plan/subscription summary (Stripe billing). `undefined` = loading. */
  billing: BillingSummary | undefined;
  /** The account's custom domains (account-level). `undefined` = loading. */
  accountDomains: AccountDomainRow[] | undefined;
  /** The CNAME target customers point their subdomain at. `undefined` = loading. */
  cnameTarget: string | undefined;
  /** The operator's own API tokens (epic #184). `undefined` = loading. */
  tokens: TokenRow[] | undefined;
  /**
   * Publish a page from an uploaded HTML file (operator session). `@recipe`
   * shorthand is expanded server-side against the account's stored palette.
   * Resolves to the live URL, or a 409 when the slug is already taken.
   */
  publishPage: (input: {
    html: string;
    slug?: string;
    visibility?: Visibility;
    tags?: string[];
  }) => Promise<
    | { ok: true; id: string; url: string; version: number }
    | { ok: false; status: 409; existingId: string }
  >;
  /**
   * Publish a linked multi-page bundle from the dashboard (operator session).
   * `files` are the bundle's HTML files (bundle-relative paths); `entryPath` is
   * the file the slug routes to. Siblings serve at `<slug>.shortwind.app/<path>`.
   */
  publishBundle: (input: {
    files: { path: string; html: string }[];
    entryPath: string;
    slug?: string;
    visibility?: Visibility;
  }) => Promise<
    | { ok: true; bundleId: string; url: string; version: number }
    | { ok: false; status: 409; existingId: string }
  >;
  /** Persist a policy toggle. Resolves to the new policy. */
  setPolicy: (next: { customDomainNeedsApproval?: boolean }) => Promise<void>;
  /** Change a page's visibility (operator session). */
  setVisibility: (id: string, visibility: Visibility) => Promise<void>;
  /** Tombstone a page (operator session). */
  deletePage: (id: string) => Promise<void>;
  /** Revoke one of the operator's own API tokens. */
  revokeToken: (tokenId: string) => Promise<void>;
  /** Start a Stripe checkout for a paid plan; resolves to the hosted URL. */
  startCheckout: (plan: "pro") => Promise<{ url: string }>;
  /** Open the Stripe customer portal; resolves to the hosted URL. */
  openPortal: () => Promise<{ url: string }>;
  /** Bind an account custom domain from the UI (operator session). */
  bindDomain: (hostname: string) => Promise<DomainBindResult>;
  /** Re-poll a pending domain's Cloudflare cert and refresh its status. */
  recheckDomain: (hostname: string) => Promise<DomainBindResult>;
  /** Approve a `pending-human` account domain (operator gate). */
  approveDomain: (hostname: string) => Promise<void>;
  /** Unbind an account domain in any state (also the stuck-bind recovery). */
  removeDomain: (hostname: string) => Promise<void>;
}
