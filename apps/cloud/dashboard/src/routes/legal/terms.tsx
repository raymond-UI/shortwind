import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/LegalLayout";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Terms of Service — Shortwind Cloud" },
      {
        name: "description",
        content:
          "The terms governing use of Shortwind Cloud, agent-native HTML hosting.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      summary="These terms govern your access to and use of Shortwind Cloud, a service that hosts and serves HTML pages published through an API or CLI."
    >
      <h2>1. Agreement to these terms</h2>
      <p>
        These Terms of Service (the <strong>“Terms”</strong>) are a binding
        agreement between you and <strong>[Operator Legal Entity]</strong> (the{" "}
        <strong>“Operator,” “we,” “us”</strong>), who operates Shortwind Cloud
        (the <strong>“Service”</strong>). By creating an account, publishing a
        page, or otherwise using the Service, you agree to these Terms and to our{" "}
        <Link to="/legal/acceptable-use">Acceptable Use Policy</Link> and{" "}
        <Link to="/legal/privacy">Privacy Policy</Link>, each incorporated here by
        reference. If you are using the Service on behalf of an organization, you
        represent that you are authorized to bind that organization.
      </p>

      <h2>2. The Service</h2>
      <p>
        The Service lets you publish HTML documents and serve them as web pages.
        Each published page is stored as an immutable version and served at a
        subdomain of <code>shortwind.app</code> (for example{" "}
        <code>your-slug.shortwind.app</code>), and, on a paid plan, at a custom
        domain you control. Pages may be published as public, unlisted, or
        private. We may add, change, or discontinue features at any time.
      </p>

      <h2>3. Accounts and API tokens</h2>
      <ul>
        <li>
          You must provide accurate account information and are responsible for
          all activity under your account.
        </li>
        <li>
          The Service authenticates automated clients (agents, CLIs) with scoped
          API tokens. You are responsible for keeping tokens secret; a leaked
          token can publish, change, or delete your content. You can revoke tokens
          at any time, and we may revoke or expire tokens to protect the Service.
        </li>
        <li>
          You must be at least the age of majority in your jurisdiction, and at
          least 13 (or the minimum age required by applicable law), to use the
          Service.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>
        Your use of the Service — and everything you publish through it — must
        comply with our <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>
        . That policy is part of these Terms, and a violation of it is a violation
        of these Terms.
      </p>

      <h2>5. Your content and the license you grant us</h2>
      <p>
        You retain all ownership of the content you publish (
        <strong>“Your Content”</strong>). To operate the Service, you grant us a
        worldwide, non-exclusive, royalty-free license to host, store, reproduce,
        cache, transmit, display, and serve Your Content, and to make technical
        modifications needed for delivery (for example expanding recipe shorthand
        into CSS at publish time, or generating an immutable stored artifact). This
        license exists only to run the Service and ends when Your Content is
        removed, except for copies retained as required by law or by Section 6.
      </p>
      <p>
        You represent and warrant that you own or have the necessary rights to Your
        Content and that it does not infringe or violate the rights of others.
        Content you mark <strong>public</strong> is accessible to anyone on the
        internet; do not publish anything as public that you would not want
        publicly available.
      </p>

      <h2>6. Content moderation, removal, and preservation</h2>
      <p>
        We may, but are not obligated to, monitor content. We scan pages at publish
        time and may remove, disable, quarantine, or restrict any content or
        account — with or without notice — that we reasonably believe violates
        these Terms, the Acceptable Use Policy, or the law, or that poses a risk to
        the Service or others.
      </p>
      <ul>
        <li>
          <strong>Child sexual abuse material (CSAM):</strong> we have zero
          tolerance. Suspected CSAM is removed, and, where required, reported to the
          National Center for Missing &amp; Exploited Children (NCMEC) or the
          relevant authority, and the associated material and records are preserved
          as required by law (including, in the United States, 18 U.S.C. § 2258A).
        </li>
        <li>
          <strong>Preservation over deletion:</strong> when we take down content for
          a legal or safety reason, we may retain (seal) a copy for the period
          required to meet our legal obligations, even after you delete your account.
        </li>
      </ul>

      <h2>7. Custom domains</h2>
      <p>
        If you connect a custom domain, you represent that you own or control it and
        authorize us to provision a TLS certificate and serve your pages on it
        through our infrastructure provider. You are responsible for your DNS
        configuration. We may refuse or revoke a domain binding that appears
        unauthorized, abusive, or non-compliant.
      </p>

      <h2>8. Plans, fees, and billing</h2>
      <ul>
        <li>
          Publishing and serving pages on <code>shortwind.app</code> subdomains are
          offered at no charge on the free plan. Paid features (such as custom
          domains) are billed through our payment processor on the plan you select.
        </li>
        <li>
          Fees are stated exclusive of taxes, which you are responsible for. Paid
          plans renew until cancelled. Except where required by law, fees are
          non-refundable.
        </li>
        <li>
          We may change pricing or plan features prospectively; we will make changes
          available before they take effect for your billing period.
        </li>
      </ul>

      <h2>9. API use and rate limits</h2>
      <p>
        You may access the Service through its API and CLI subject to these Terms
        and any published rate limits. You must not circumvent limits, probe or
        disrupt the Service, or use it to build a competing bulk-hosting service in
        violation of the Acceptable Use Policy. We may throttle, suspend, or block
        clients that threaten the stability or integrity of the Service.
      </p>

      <h2>10. Intellectual property</h2>
      <p>
        The Service’s software, design, and trademarks are owned by the Operator or
        its licensors. Shortwind is open-source software offered under its published
        license; that license governs the software itself, while these Terms govern
        your use of the hosted Service. Nothing here transfers our IP to you beyond
        the limited right to use the Service.
      </p>

      <h2>11. Third-party services</h2>
      <p>
        The Service runs on third-party infrastructure and processors (for example
        our edge/CDN, backend, storage, and payment providers). Your use may be
        subject to their terms, and your data is handled as described in our{" "}
        <Link to="/legal/privacy">Privacy Policy</Link>.
      </p>

      <h2>12. Suspension and termination</h2>
      <p>
        You may stop using the Service and close your account at any time. We may
        suspend or terminate your access if you breach these Terms, if required by
        law, or to protect the Service or others. On termination we may remove your
        content and revoke your tokens; you can export your data before closing your
        account. Content under a legal-hold or preservation obligation (Section 6)
        survives account closure. Sections that by their nature should survive —
        including ownership, disclaimers, limitation of liability, and
        indemnification — survive termination.
      </p>

      <h2>13. Disclaimers</h2>
      <p>
        The Service is provided <strong>“as is” and “as available,”</strong> without
        warranties of any kind, whether express, implied, or statutory, including
        implied warranties of merchantability, fitness for a particular purpose, and
        non-infringement. We do not warrant that the Service will be uninterrupted,
        secure, or error-free, or that content will always be available or
        preserved.
      </p>

      <h2>14. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, the Operator will not be liable for
        any indirect, incidental, special, consequential, or punitive damages, or
        for lost profits, data, or goodwill, arising out of or relating to the
        Service. Our total liability for any claim relating to the Service will not
        exceed the greater of the amounts you paid us in the twelve months before
        the claim or <strong>[USD 100]</strong>. Some jurisdictions do not allow
        these limits, so they may not apply to you.
      </p>

      <h2>15. Indemnification</h2>
      <p>
        You will defend, indemnify, and hold harmless the Operator from claims,
        damages, and expenses (including reasonable legal fees) arising from Your
        Content or your use of the Service in breach of these Terms or the law.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        We may update these Terms. If we make material changes, we will take
        reasonable steps to notify you (for example by posting the updated Terms
        with a new effective date). Your continued use after changes take effect
        means you accept the updated Terms.
      </p>

      <h2>17. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of{" "}
        <strong>[Governing Jurisdiction]</strong>, without regard to its
        conflict-of-laws rules, and any dispute will be resolved in the courts
        located in <strong>[Venue]</strong>, unless applicable law provides
        otherwise.
      </p>

      <h2>18. General</h2>
      <p>
        These Terms, together with the policies referenced here, are the entire
        agreement between you and the Operator regarding the Service. If any
        provision is unenforceable, the rest remains in effect. We may assign these
        Terms in connection with a merger, acquisition, or sale of assets. Our
        failure to enforce a provision is not a waiver of it.
      </p>

      <h2>19. Contact</h2>
      <p>
        Questions about these Terms:{" "}
        <a href="mailto:[legal@your-domain]">[legal@your-domain]</a>,{" "}
        <strong>[Operator Legal Entity]</strong>, <strong>[Mailing Address]</strong>.
      </p>
    </LegalLayout>
  );
}
