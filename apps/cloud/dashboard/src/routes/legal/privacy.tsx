import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/LegalLayout";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Privacy Policy — Shortwind Cloud" },
      {
        name: "description",
        content:
          "What data Shortwind Cloud collects, how it is used, and your rights.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      summary="What data Shortwind Cloud collects, why, who processes it, how long we keep it, and the rights you have over it."
    >
      <h2>1. Who we are</h2>
      <p>
        <strong>[Operator Legal Entity]</strong> (the <strong>“Operator,” “we”</strong>)
        operates Shortwind Cloud and is the controller of the personal data
        described here. Contact us at{" "}
        <a href="mailto:[privacy@your-domain]">[privacy@your-domain]</a>. If your
        jurisdiction requires a data protection officer or representative, that is{" "}
        <strong>[DPO / EU-UK Representative, if any]</strong>.
      </p>

      <h2>2. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> your email address, an optional name, and
          authentication identifiers, so you can sign in and own an account.
        </li>
        <li>
          <strong>Content you publish:</strong> the HTML you publish and its stored,
          versioned artifacts, page slugs/subdomains, tags, and visibility settings.
          Published content may itself contain personal data you choose to include —
          you control that.
        </li>
        <li>
          <strong>API tokens:</strong> we store only a one-way hash of each token
          secret, never the secret itself, plus its scopes and metadata.
        </li>
        <li>
          <strong>Custom domains:</strong> the hostnames you connect and their
          certificate/validation status.
        </li>
        <li>
          <strong>Billing data:</strong> if you buy a paid plan, our payment
          processor collects and processes your payment details; we store a customer
          and subscription reference and plan status, not full card numbers.
        </li>
        <li>
          <strong>Usage and operational data:</strong> metered usage (such as
          publish counts and storage), an audit log of actions on your account,
          recipe-edit events, and server logs used to run, secure, and debug the
          Service.
        </li>
        <li>
          <strong>Abuse reports:</strong> when someone reports a page, we collect the
          report details and any contact information the reporter provides.
        </li>
        <li>
          <strong>Cookies:</strong> the dashboard uses a session cookie to keep you
          signed in. We do not use advertising cookies.
        </li>
      </ul>

      <h2>3. How we use data</h2>
      <ul>
        <li>To provide, operate, secure, and improve the Service.</li>
        <li>To authenticate you and your API clients and enforce scopes and limits.</li>
        <li>
          To detect, prevent, and respond to abuse, fraud, and illegal content —
          including scanning content at publish time and acting on reports.
        </li>
        <li>To process payments and manage subscriptions.</li>
        <li>To communicate about the Service, security, and legal notices.</li>
        <li>To comply with legal obligations and enforce our Terms.</li>
      </ul>

      <h2>4. Legal bases (EEA/UK)</h2>
      <p>
        Where the GDPR or UK GDPR applies, we rely on: <strong>performance of a
        contract</strong> (to provide the Service you request); our{" "}
        <strong>legitimate interests</strong> (to secure the Service, prevent abuse,
        and operate our business); <strong>legal obligation</strong> (for example
        mandatory reporting and preservation of CSAM); and, where applicable,{" "}
        <strong>consent</strong>, which you may withdraw.
      </p>

      <h2>5. Who we share data with</h2>
      <p>
        We do not sell your personal data. We share it with service providers
        (processors) who help us run the Service under contract, including:
      </p>
      <ul>
        <li>
          <strong>Edge / CDN, storage, and networking</strong> provider(s) that
          serve and store your pages and handle custom-domain certificates
          (e.g. Cloudflare).
        </li>
        <li>
          <strong>Backend and database</strong> provider that runs the application
          and stores account and control-plane data (e.g. Convex).
        </li>
        <li>
          <strong>Payment processor</strong> for paid plans (e.g. Stripe).
        </li>
        <li>
          <strong>Child-safety authorities:</strong> for suspected CSAM, we report to
          NCMEC or the relevant authority and preserve the material as required by
          law.
        </li>
        <li>
          <strong>Law enforcement or others</strong> where required by law, to
          protect rights and safety, or in a corporate transaction (merger, sale).
        </li>
      </ul>
      <p>
        Maintain the authoritative, current list of subprocessors at{" "}
        <strong>[link to your subprocessor list]</strong>.
      </p>

      <h2>6. Retention</h2>
      <ul>
        <li>
          <strong>Account and content:</strong> kept while your account is active.
          When you delete content or close your account, we remove it from active
          serving; backups age out on our normal cycle.
        </li>
        <li>
          <strong>Preserved (quarantined) material:</strong> content removed for a
          legal or safety reason may be sealed and retained for the period the law
          requires (for example, CSAM records for at least the statutory
          preservation window). <strong>This retention survives account deletion.</strong>
        </li>
        <li>
          <strong>Tokens:</strong> retained (as hashes) until revoked or expired.
        </li>
        <li>
          <strong>Logs and audit records:</strong> retained for a limited period for
          security and compliance.
        </li>
      </ul>

      <h2>7. Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR/UK GDPR or the
        CCPA/CPRA), you may have the right to access, correct, delete, or export
        your data, to object to or restrict certain processing, and to not be
        discriminated against for exercising these rights. Shortwind Cloud supports
        the core rights directly:
      </p>
      <ul>
        <li>
          <strong>Access / portability:</strong> export a machine-readable bundle of
          your account’s data from the API/CLI.
        </li>
        <li>
          <strong>Deletion / closure:</strong> close your account, which revokes your
          credentials and takes down your active pages — except material under a
          legal-hold or preservation obligation, which we must retain.
        </li>
      </ul>
      <p>
        To exercise a right we don’t automate, contact{" "}
        <a href="mailto:[privacy@your-domain]">[privacy@your-domain]</a>. You may also
        have the right to complain to your local data protection authority.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Our providers may process data in countries other than yours. Where required,
        we rely on appropriate safeguards (such as Standard Contractual Clauses) for
        international transfers.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is not directed to children under 13 (or the minimum age in your
        jurisdiction), and we do not knowingly collect their personal data. Content
        that sexually exploits minors is strictly prohibited and handled under our{" "}
        <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>.
      </p>

      <h2>10. Security</h2>
      <p>
        We use technical and organizational measures to protect data — including
        hashing token secrets, scoping credentials, and encrypting data in transit.
        No system is perfectly secure, and we cannot guarantee absolute security.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this policy; material changes take effect on posting with a new
        effective date, and we will take reasonable steps to notify you.
      </p>

      <h2>12. Contact</h2>
      <p>
        <strong>[Operator Legal Entity]</strong> —{" "}
        <a href="mailto:[privacy@your-domain]">[privacy@your-domain]</a>,{" "}
        <strong>[Mailing Address]</strong>.
      </p>
    </LegalLayout>
  );
}
