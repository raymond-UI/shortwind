import { describe, expect, it } from "vitest";
import { runApproveDomain } from "./approve-domain.js";
import { InvalidHostnameError } from "./bind-domain.js";
import type { DomainBindResult, DomainCapableClient } from "../api-client.js";

const ACTIVE: DomainBindResult = {
  state: "active",
  hostname: "pages.acme.com",
  cloudflareHostnameId: "cf_1",
};

describe("runApproveDomain", () => {
  it("approves a valid hostname and renders the bind state", async () => {
    let seen: string | undefined;
    const client: Pick<DomainCapableClient, "approveDomain"> = {
      approveDomain: async (hostname) => {
        seen = hostname;
        return ACTIVE;
      },
    };
    const out = await runApproveDomain("pages.acme.com", {}, client);
    expect(seen).toBe("pages.acme.com");
    expect(out).toBe("bind pages.acme.com: active");
  });

  it("rejects a malformed hostname before any call", async () => {
    let called = false;
    const client: Pick<DomainCapableClient, "approveDomain"> = {
      approveDomain: async () => {
        called = true;
        return ACTIVE;
      },
    };
    await expect(
      runApproveDomain("not a host!", {}, client),
    ).rejects.toBeInstanceOf(InvalidHostnameError);
    expect(called).toBe(false);
  });
});
