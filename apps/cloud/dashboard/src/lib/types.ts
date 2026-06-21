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
  customDomain: string | null;
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
  /** Persist a policy toggle. Resolves to the new policy. */
  setPolicy: (next: { customDomainNeedsApproval?: boolean }) => Promise<void>;
}
