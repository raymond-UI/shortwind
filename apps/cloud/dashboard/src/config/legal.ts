/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LEGAL / OPERATOR CONFIG  —  edit THIS file to make the legal pages yours.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The public legal pages (Terms, Acceptable Use, Privacy, DMCA) read every
 * operator-specific value from here, so a self-hoster changes ONE file instead of
 * hunting through four documents.
 *
 * Fields are grouped by how much attention they need:
 *   • PRODUCT   — already accurate for Shortwind Cloud; only change if you fork
 *                 the product or run on different infrastructure.
 *   • REQUIRED  — you MUST set these before relying on the pages (they start as
 *                 obvious `[bracketed]` placeholders so an unset value is visible).
 *   • OPTIONAL  — leave blank ("") to hide the related sentence.
 *
 * None of this is legal advice — have counsel review the rendered pages.
 */

export const LEGAL_CONFIG = {
  // ── PRODUCT (pre-filled) ──────────────────────────────────────────────────
  /** Product name shown in titles and prose. */
  serviceName: "Shortwind Cloud",
  /** Short brand name used inline (e.g. "…the Shortwind platform"). */
  brand: "Shortwind",
  /** Where published pages are served (subdomains of this). */
  pagesDomain: "shortwind.app",
  /** Domain your contact addresses live on — emails derive as name@thisDomain. */
  contactDomain: "shortwind.dev",

  // ── REQUIRED — set these (legal identity; do not guess on someone's behalf) ─
  /** Your legal entity, e.g. "Shortwind, Inc." — the party the Terms bind to. */
  legalEntity: "MZED STUDIO LIMITED",
  /** Postal address for legal/DMCA correspondence. */
  mailingAddress:
    "8 Eastfield Close, Townhill, Swansea, SA1 6SG, United Kingdom (Company No. 15854033)",
  /** Governing law, e.g. "the State of Delaware, United States". */
  governingJurisdiction: "England and Wales",
  /** Court venue for disputes, e.g. "New Castle County, Delaware". */
  venue: "the courts of England and Wales",
  /** The date these terms take effect, e.g. "13 July 2026". */
  effectiveDate: "13 July 2026",

  // ── OPTIONAL (blank "" hides the related sentence) ────────────────────────
  /** Liability cap amount; defaults to USD 100 if blank. */
  liabilityCap: "GBP 100",
  /** EU/UK data-protection representative or DPO, if you have one. */
  dpo: "",
  /** Public URL of your subprocessor list, if you maintain one separately. */
  subprocessorsUrl: "",
  /** URL of the open-source license / repository governing the software. */
  softwareLicenseUrl: "",
  /** Explicit email overrides. Leave blank to use name@contactDomain. */
  emailOverrides: {
    legal: "",
    privacy: "",
    abuse: "",
    dmca: "",
  } as Record<LegalEmailKind, string>,

  // ── DMCA designated agent (REQUIRED for the U.S. §512 safe harbor) ────────
  dmcaAgent: {
    /** Name of your registered DMCA agent. */
    name: "MZED STUDIO LIMITED (Attn: Copyright Agent)",
    /** The agent's mailing address (may differ from the entity address). */
    address: "8 Eastfield Close, Townhill, Swansea, SA1 6SG, United Kingdom",
    /**
     * Note/reference for your U.S. Copyright Office agent registration. Registering
     * is only needed if you want the U.S. DMCA §512 safe harbor; leave the
     * placeholder until you have completed registration at dmca.copyright.gov.
     */
    registration: "[U.S. Copyright Office agent registration reference]",
  },

  // ── Subprocessors named in the Privacy Policy (pre-filled for Shortwind) ──
  /** Third parties that process data on your behalf. Edit if your infra differs. */
  subprocessors: [
    {
      name: "Cloudflare",
      role: "Edge/CDN serving, object storage (R2), key–value routing, and custom-domain TLS certificates",
    },
    { name: "Convex", role: "Application backend and control-plane database" },
    { name: "Stripe", role: "Payment processing for paid plans" },
    {
      name: "NCMEC",
      role: "Receiving mandatory CSAM reports (as required by law)",
    },
  ],
} as const;

export type LegalEmailKind = "legal" | "privacy" | "abuse" | "dmca";

/** The contact email for a purpose: an explicit override, else name@contactDomain. */
export function legalEmail(kind: LegalEmailKind): string {
  const override = LEGAL_CONFIG.emailOverrides[kind];
  return override && override.length > 0
    ? override
    : `${kind}@${LEGAL_CONFIG.contactDomain}`;
}
