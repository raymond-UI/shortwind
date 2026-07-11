import type {
  AccountDomainRow,
  AccountThemeSettings,
  AuditRow,
  BillingSummary,
  DashboardData,
  ModerationRow,
  PageWithVersions,
  RecipeEditRow,
  RecipeFamilyRow,
  AccountPolicy,
  TokenRow,
  UsageMeters,
} from "../lib/types";

/**
 * Mock oversight data (CLOUD-35 component tests). Plain serializable objects in
 * the exact shapes `convex/dashboard.ts` returns — no Convex client involved.
 */

export const mockPages: PageWithVersions[] = [
  {
    page: {
      id: "page_1",
      slug: "launch",
      visibility: "public",
      lifecycle: "active",
      tags: ["marketing"],
      currentVersion: 3,
      updatedAt: 1_700_000_200_000,
      createdAt: 1_700_000_000_000,
    },
    versions: [
      {
        id: "ver_3",
        version: 3,
        artifactKey: "r2/launch/3",
        expandedHash: "abcdef1234567890",
        sourceHash: "0011223344556677",
        createdAt: 1_700_000_200_000,
      },
      {
        id: "ver_2",
        version: 2,
        artifactKey: "r2/launch/2",
        expandedHash: "ffeeddccbbaa9988",
        sourceHash: "8899aabbccddeeff",
        createdAt: 1_700_000_100_000,
      },
    ],
  },
  {
    page: {
      id: "page_2",
      slug: "pulled",
      visibility: "private",
      lifecycle: "tombstoned",
      tags: [],
      currentVersion: 1,
      updatedAt: 1_700_000_050_000,
      createdAt: 1_700_000_010_000,
    },
    versions: [],
  },
];

export const mockAuditLog: AuditRow[] = [
  {
    id: "audit_2",
    action: "page.publish",
    targetId: "page_1",
    actorTokenId: "tok_1",
    metadata: { version: 3 },
    createdAt: 1_700_000_200_000,
  },
  {
    id: "audit_1",
    action: "page.delete",
    targetId: "page_2",
    actorTokenId: "tok_1",
    metadata: {},
    createdAt: 1_700_000_050_000,
  },
];

export const mockRecipeEdits: RecipeEditRow[] = [
  {
    id: "redit_1",
    family: "card",
    fromVersion: "0.4.0",
    toVersion: "0.5.0",
    bodySha: "deadbeefcafef00d",
    actorTokenId: "tok_1",
    createdAt: 1_700_000_200_000,
    affectedPages: 12,
  },
  {
    id: "redit_2",
    family: "button",
    fromVersion: null,
    toVersion: "0.1.0",
    bodySha: "1234abcd5678ef90",
    actorTokenId: "tok_1",
    createdAt: 1_700_000_150_000,
    affectedPages: 1,
  },
];

export const mockRecipeVersions: RecipeFamilyRow[] = [
  {
    family: "button",
    version: "1.0.0",
    bodySha: "1111222233334444",
    body: "@recipe button {\n  inline-flex items-center rounded-md bg-primary px-3 py-2 text-primary-foreground\n}\n",
    createdAt: 1_700_000_000_000,
    isStandard: true,
  },
  {
    family: "card",
    version: "1.0.0",
    bodySha: "5555666677778888",
    body: "@recipe card {\n  rounded-lg border bg-card p-4 text-card-foreground\n}\n",
    createdAt: 1_700_000_050_000,
    isStandard: true,
  },
  {
    family: "hero-banner",
    version: "0.1.0",
    bodySha: "9999aaaabbbbcccc",
    body: "@recipe hero-banner {\n  grid gap-6 py-20 text-center\n}\n",
    createdAt: 1_700_000_100_000,
    isStandard: false,
  },
];

export const mockTheme: AccountThemeSettings = {
  accent: "oklch(0.205 0 0)",
  radius: "0.625rem",
  isDefault: true,
};

export const mockModeration: ModerationRow[] = [
  {
    id: "mod_1",
    pageId: "page_9",
    state: "quarantined",
    reason: "reported: phishing",
    reporterContact: "abuse@example.org",
    ncmecReportId: null,
    preservedR2Key: "sealed/page_9",
    preservationExpiresAt: 1_705_000_000_000,
    createdAt: 1_700_000_300_000,
    updatedAt: 1_700_000_400_000,
  },
];

export const mockPolicy: AccountPolicy = {
  customDomainNeedsApproval: true,
  updatedAt: 1_700_000_000_000,
};

export const mockTokens: TokenRow[] = [
  {
    tokenId: "tok_active",
    scopes: ["pages:read", "pages:write"],
    label: "laptop CLI",
    createdAt: 1_700_000_000_000,
    revokedAt: null,
    expiresAt: null,
  },
  {
    tokenId: "tok_revoked",
    scopes: ["pages:read"],
    label: "old token",
    createdAt: 1_699_000_000_000,
    revokedAt: 1_699_500_000_000,
    expiresAt: null,
  },
];

/** Mock metered-billing usage (CLOUD-43). Shapes `billing.getUsage` returns. */
export const mockUsage: UsageMeters = {
  publishes: 42,
  customDomains: 3,
  storageBytes: 5_242_880, // 5 MiB
  periodStart: null,
  periodEnd: 1_700_000_400_000,
};

/** Mock billing summary — an active Pro subscription. Shapes `summary` returns. */
export const mockBilling: BillingSummary = {
  plan: "pro",
  hasActive: true,
  currentPeriodEnd: 1_735_689_600, // unix seconds (Stripe period end)
  cancelAtPeriodEnd: false,
};

/** Mock account domains — one active, one awaiting operator approval. */
export const mockAccountDomains: AccountDomainRow[] = [
  {
    id: "dom_active",
    hostname: "pages.acme.com",
    status: "active",
    verifiedAt: 1_700_000_300_000,
    createdAt: 1_700_000_000_000,
  },
  {
    id: "dom_pending",
    hostname: "www.acme.com",
    status: "pending-human",
    verifiedAt: null,
    createdAt: 1_700_000_100_000,
  },
];

/**
 * Build a `DashboardData` from optional overrides. `setPolicy` defaults to a
 * spy-able async no-op so policy tests can assert it was called.
 */
export function makeData(
  overrides: Partial<DashboardData> = {},
): DashboardData {
  return {
    pages: mockPages,
    auditLog: mockAuditLog,
    recipeEdits: mockRecipeEdits,
    recipeVersions: mockRecipeVersions,
    theme: mockTheme,
    moderation: mockModeration,
    policy: mockPolicy,
    usage: mockUsage,
    billing: mockBilling,
    accountDomains: mockAccountDomains,
    cnameTarget: "cname.shortwind.app",
    tokens: mockTokens,
    publishPage: async (input) => ({
      ok: true,
      id: "pg_test",
      url: `https://${input.slug ?? "new-page"}.shortwind.app`,
      version: 1,
    }),
    publishBundle: async (input) => ({
      ok: true,
      bundleId: input.slug ?? "site",
      url: `https://${input.slug ?? "site"}.shortwind.app`,
      version: 1,
    }),
    resetRecipes: async () => ({ reset: 0 }),
    setTheme: async (next) => ({ ...next, isDefault: false }),
    setPolicy: async () => {},
    setVisibility: async () => {},
    deletePage: async () => {},
    revokeToken: async () => {},
    startCheckout: async () => ({ url: "https://checkout.stripe.test/session" }),
    openPortal: async () => ({ url: "https://portal.stripe.test/session" }),
    bindDomain: async (hostname) => ({
      state: "pending-cert",
      hostname,
      cloudflareHostnameId: "cf_test",
    }),
    recheckDomain: async (hostname) => ({
      state: "active",
      hostname,
      cloudflareHostnameId: "cf_test",
    }),
    approveDomain: async () => {},
    removeDomain: async () => {},
    ...overrides,
  };
}
