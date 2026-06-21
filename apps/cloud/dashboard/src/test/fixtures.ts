import type {
  AuditRow,
  DashboardData,
  ModerationRow,
  PageWithVersions,
  RecipeEditRow,
  AccountPolicy,
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
      customDomain: "example.com",
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
      customDomain: null,
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

/** Mock metered-billing usage (CLOUD-43). Shapes `billing.getUsage` returns. */
export const mockUsage: UsageMeters = {
  publishes: 42,
  customDomains: 3,
  storageBytes: 5_242_880, // 5 MiB
  periodStart: null,
  periodEnd: 1_700_000_400_000,
};

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
    moderation: mockModeration,
    policy: mockPolicy,
    usage: mockUsage,
    setPolicy: async () => {},
    ...overrides,
  };
}
