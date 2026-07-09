import { describe, expect, it } from "vitest";
import { renderListDomains, runListDomains } from "./list-domains.js";
import type { AccountDomain, DomainCapableClient } from "../api-client.js";

const DOMAINS: AccountDomain[] = [
  {
    id: "dom_a",
    hostname: "pages.acme.com",
    status: "active",
    verifiedAt: 2000,
    createdAt: 1000,
  },
  {
    id: "dom_b",
    hostname: "www.acme.com",
    status: "pending-human",
    verifiedAt: null,
    createdAt: 1500,
  },
];

describe("renderListDomains — golden output", () => {
  it("lists hostname + status, one per line", () => {
    const out = renderListDomains(DOMAINS, false);
    expect(out).toContain("pages.acme.com");
    expect(out).toContain("active");
    expect(out).toContain("www.acme.com");
    expect(out).toContain("pending-human");
  });

  it("prints a bind hint when there are no domains", () => {
    expect(renderListDomains([], false)).toMatch(/no custom domains/);
  });

  it("--json emits the { domains } envelope verbatim", () => {
    expect(JSON.parse(renderListDomains(DOMAINS, true))).toEqual({
      domains: DOMAINS,
    });
  });
});

describe("runListDomains", () => {
  it("fetches via listDomains and renders", async () => {
    const client: Pick<DomainCapableClient, "listDomains"> = {
      listDomains: async () => ({ domains: DOMAINS }),
    };
    const out = await runListDomains({ json: true }, client);
    expect(JSON.parse(out)).toEqual({ domains: DOMAINS });
  });
});
