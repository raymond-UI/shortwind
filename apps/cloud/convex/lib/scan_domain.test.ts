import { describe, expect, it } from "vitest";
import {
  extractOutboundHosts,
  makeDomainBlocklist,
  screenOutboundHosts,
} from "./content_scan.js";
import { loadScanSources, splitList } from "./scan_config.js";

/**
 * #198 item 5 — outbound-domain reputation screening + config-driven activation
 * (items 1 & 5). Pure decision logic; the publish-path wiring is covered in the
 * pages scan integration test.
 */

describe("extractOutboundHosts", () => {
  it("pulls distinct http(s) hosts from href/src/action, normalized", () => {
    const html = `
      <a href="https://Evil.com/phish">x</a>
      <img src='http://cdn.evil.com/a.png'>
      <form action="https://evil.com/submit">
      <a href="/relative">no host</a>
      <a href="mailto:x@y.com">mail</a>
      <a href="https://good.org">ok</a>
    `;
    expect(extractOutboundHosts(html)).toEqual([
      "evil.com",
      "cdn.evil.com",
      "good.org",
    ]);
  });

  it("returns [] when there are no absolute outbound URLs", () => {
    expect(extractOutboundHosts(`<a href="#top">t</a><img src="/x.png">`)).toEqual(
      [],
    );
  });
});

describe("screenOutboundHosts", () => {
  const source = makeDomainBlocklist(["evil.com", "bad.net"]);

  it("blocks on the first blocklisted host", async () => {
    const html = `<a href="https://ok.com">a</a><a href="https://evil.com/x">b</a>`;
    expect(await screenOutboundHosts(html, source)).toEqual({
      ok: false,
      blockedHost: "evil.com",
    });
  });

  it("passes when no outbound host is blocklisted", async () => {
    const html = `<a href="https://ok.com">a</a><a href="https://fine.org">b</a>`;
    expect(await screenOutboundHosts(html, source)).toEqual({ ok: true });
  });

  it("passes with the default (empty) source", async () => {
    expect(
      await screenOutboundHosts(`<a href="https://anything.com">x</a>`),
    ).toEqual({ ok: true });
  });
});

describe("loadScanSources (config-driven activation)", () => {
  it("splitList handles whitespace/comma/newline separators", () => {
    expect(splitList("a, b\nc  d")).toEqual(["a", "b", "c", "d"]);
    expect(splitList(undefined)).toEqual([]);
    expect(splitList("")).toEqual([]);
  });

  it("defaults to match-nothing sources when env is empty", async () => {
    const s = loadScanSources({});
    expect(await s.hashList.has("deadbeef")).toBe(false);
    expect(await s.domainSource.isBlocked("evil.com")).toBe(false);
    expect(s.hashList.id).toBe("ncmec");
  });

  it("activates a hash list + domain blocklist from env", async () => {
    const s = loadScanSources({
      CSAM_HASHLIST: "AAA111\nbbb222",
      CSAM_HASHLIST_ID: "ncmec-2026",
      DOMAIN_BLOCKLIST: "evil.com, bad.net",
    });
    expect(s.hashList.id).toBe("ncmec-2026");
    expect(await s.hashList.has("aaa111")).toBe(true); // lowercased by makeHashList
    expect(await s.hashList.has("nope")).toBe(false);
    expect(await s.domainSource.isBlocked("evil.com")).toBe(true);
    expect(await s.domainSource.isBlocked("ok.com")).toBe(false);
  });
});
