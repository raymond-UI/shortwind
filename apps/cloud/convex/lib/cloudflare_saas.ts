import { ConvexError } from "convex/values";
import type {
  CloudflareSaaSClient,
  CreateCustomHostnameResult,
  CustomHostnameCertStatus,
  CustomHostnameRecord,
} from "../domains.js";

/**
 * The REAL Cloudflare-for-SaaS custom-hostnames client (ported from togethr's
 * `convex/domains.ts`). Replaces the closed-by-default `NOT_CONFIGURED` stub so
 * a bind actually provisions a cert. Injected via `__setCloudflareSaaSClient`
 * for tests; this is the production default in `domains.ts`.
 *
 * Cloudflare for SaaS, HTTP domain-validation (DV): we create a custom hostname
 * in ONE shared zone (`CLOUDFLARE_ZONE_ID` = the `shortwind.app` zone); the
 * customer only has to add a CNAME from their subdomain to our fallback origin
 * (`CUSTOM_DOMAIN_CNAME_TARGET`). CF then HTTP-validates and issues the cert.
 * Env (read at call time, like the Stripe client): `CLOUDFLARE_API_TOKEN`
 * (Custom Hostnames + SSL edit), `CLOUDFLARE_ZONE_ID`.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CfHostnameResult {
  id: string;
  hostname?: string;
  status?: string; // hostname status: "pending" | "active" | …
  ssl?: { status?: string }; // "pending_validation" | "pending_issuance" | "initializing" | "active" | …
}

interface CfEnvelope {
  success: boolean;
  result?: CfHostnameResult;
  errors?: Array<{ message?: string }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new ConvexError({
      code: "NOT_CONFIGURED",
      message: `${name} is not set — Cloudflare for SaaS is not configured.`,
    });
  }
  return value;
}

async function cfFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = requireEnv("CLOUDFLARE_API_TOKEN");
  return fetch(`${CF_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

/**
 * Map Cloudflare's (hostname status, ssl status) → Shortwind's cert status.
 * `active` only when BOTH the hostname and its cert are active. Any CF ssl
 * value outside the known-pending set collapses to `initializing` (still
 * pending), so `classifyCertStatus` treats it as "keep polling", never a serve.
 */
function toCertStatus(r: CfHostnameResult): CustomHostnameCertStatus {
  const ssl = r.ssl?.status;
  if (r.status === "active" && ssl === "active") return "active";
  switch (ssl) {
    case "pending_validation":
    case "pending_issuance":
    case "initializing":
      return ssl;
    default:
      // pending_deployment / holding / active-but-hostname-not-yet / unknown.
      return "initializing";
  }
}

function toRecord(r: CfHostnameResult, hostname: string): CustomHostnameRecord {
  return {
    id: r.id,
    hostname: r.hostname ?? hostname,
    certStatus: toCertStatus(r),
  };
}

export function makeCloudflareSaaSClient(): CloudflareSaaSClient {
  return {
    async createCustomHostname(
      hostname: string,
    ): Promise<CreateCustomHostnameResult> {
      const zoneId = requireEnv("CLOUDFLARE_ZONE_ID");
      const res = await cfFetch(`/zones/${zoneId}/custom_hostnames`, {
        method: "POST",
        body: JSON.stringify({
          hostname,
          // HTTP DV: the customer only adds a CNAME; CF validates over HTTP.
          ssl: { method: "http", type: "dv" },
        }),
      });
      // 429 → cert-issuance rate limit (PRD §9); the caller queues + retries.
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "60");
        return { rateLimited: true, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 60 };
      }
      const data = (await res.json()) as CfEnvelope;
      if (!data.success || !data.result) {
        throw new ConvexError({
          code: "CLOUDFLARE_ERROR",
          message: data.errors?.[0]?.message ?? "cloudflare custom-hostname create failed",
        });
      }
      return { record: toRecord(data.result, hostname) };
    },

    async getCustomHostname(id: string): Promise<CustomHostnameRecord> {
      const zoneId = requireEnv("CLOUDFLARE_ZONE_ID");
      const res = await cfFetch(`/zones/${zoneId}/custom_hostnames/${id}`);
      const data = (await res.json()) as CfEnvelope;
      if (!data.success || !data.result) {
        throw new ConvexError({
          code: "CLOUDFLARE_ERROR",
          message: data.errors?.[0]?.message ?? "cloudflare custom-hostname read failed",
        });
      }
      return toRecord(data.result, data.result.hostname ?? "");
    },
  };
}
