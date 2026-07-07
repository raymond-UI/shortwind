import { describe, expect, it } from "vitest";
import { classifyCertStatus } from "./domains.js";

/**
 * Pure cert-verdict classification. The custom-domain BIND + serve behavior is
 * account-level now and lives in `account_domains.test.ts` (convex-test); the
 * per-page bind was removed. This keeps the pure poll-loop decision covered.
 */
describe("classifyCertStatus — pure cert verdict", () => {
  it("maps active → active, failed → failed, the rest → pending", () => {
    expect(classifyCertStatus("active")).toBe("active");
    expect(classifyCertStatus("failed")).toBe("failed");
    expect(classifyCertStatus("initializing")).toBe("pending");
    expect(classifyCertStatus("pending_validation")).toBe("pending");
    expect(classifyCertStatus("pending_issuance")).toBe("pending");
  });
});
