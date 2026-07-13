import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/LegalLayout";
import { legalEmail } from "@/config/legal";

export const Route = createFileRoute("/legal/acceptable-use")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Acceptable Use Policy — Shortwind Cloud" },
      {
        name: "description",
        content:
          "What you may and may not publish or do on Shortwind Cloud.",
      },
    ],
  }),
  component: AupPage,
});

function AupPage() {
  return (
    <LegalLayout
      title="Acceptable Use Policy"
      summary="What you may and may not publish or do on Shortwind Cloud. This policy is part of the Terms of Service."
    >
      <h2>1. Scope</h2>
      <p>
        This Acceptable Use Policy (the <strong>“AUP”</strong>) applies to everyone
        who uses Shortwind Cloud and to everything published through it, whether by
        a human, a CLI, or an automated agent. It is part of, and incorporated into,
        our <Link to="/legal/terms">Terms of Service</Link>. Because pages are often
        published by agents on your behalf, <strong>you are responsible for what
        your agents publish</strong> under your account.
      </p>

      <h2>2. Prohibited content</h2>
      <p>You must not publish, host, link to, or distribute content that:</p>
      <ul>
        <li>
          <strong>Sexually exploits or endangers minors</strong> in any way,
          including child sexual abuse material (CSAM). This is strictly prohibited
          and is reported and preserved as described in Section 6.
        </li>
        <li>
          Is unlawful, or facilitates illegal activity, under applicable law.
        </li>
        <li>
          Is designed to defraud or deceive — including <strong>phishing</strong>,
          fake login or “verify your account” pages, brand impersonation, or
          deceptive payment/wallet-draining pages.
        </li>
        <li>
          Distributes <strong>malware</strong>, spyware, ransomware, cryptocurrency
          miners, or code intended to harm, surveil, or gain unauthorized access to
          a device or network.
        </li>
        <li>
          Infringes intellectual property or other rights (see our{" "}
          <Link to="/legal/copyright">Copyright &amp; Takedown Policy</Link>).
        </li>
        <li>
          Is harassing, threatening, defamatory, or incites violence, or promotes
          terrorism or violent extremism.
        </li>
        <li>
          Discloses another person’s private or personal information without
          authorization (doxxing), or non-consensual intimate imagery.
        </li>
        <li>
          Is spam, or exists primarily to manipulate search rankings, run redirect
          chains, or drive traffic to any of the above.
        </li>
      </ul>

      <h2>3. Prohibited conduct</h2>
      <ul>
        <li>
          Probing, scanning, overloading, or disrupting the Service or its
          infrastructure; circumventing rate limits, quotas, authentication, or
          content moderation.
        </li>
        <li>
          Using the Service to attack, relay attacks against, or stage command-and-
          control for attacks on third parties.
        </li>
        <li>
          Impersonating others, or misrepresenting your affiliation, to obtain
          access or deceive users.
        </li>
        <li>
          Reselling or sublicensing raw hosting capacity in a way that offloads AUP
          compliance from you, or using the Service to build a competing bulk-
          hosting product.
        </li>
        <li>
          Using automated clients to publish at a volume or rate intended to evade
          limits or degrade the Service for others.
        </li>
      </ul>

      <h2>4. Resource use</h2>
      <p>
        Pages are served as static, immutable artifacts from the edge. Do not use
        the Service to host content or run patterns that place an unreasonable load
        on the platform, or that are structured to abuse free serving (for example
        as a general-purpose file-distribution or bandwidth-farming backend).
      </p>

      <h2>5. Reporting abuse</h2>
      <p>
        If you find content on the Service that violates this policy, report it to{" "}
        <a href={`mailto:${legalEmail("abuse")}`}>{legalEmail("abuse")}</a>. Reports are
        routed to a monitored channel. Please include the page URL and a short
        description of the problem. Copyright complaints should follow the process
        in our <Link to="/legal/copyright">Copyright &amp; Takedown Policy</Link>.
      </p>

      <h2>6. Enforcement</h2>
      <p>
        We enforce this policy both proactively and reactively:
      </p>
      <ul>
        <li>
          <strong>At publish time,</strong> pages are scanned; content matching
          known-abuse signals or our classifiers may be blocked, or published and
          flagged for review.
        </li>
        <li>
          <strong>On violation,</strong> we may remove or quarantine content,
          disable pages, suspend or terminate accounts, and revoke tokens — with or
          without notice, depending on severity and legal obligations.
        </li>
        <li>
          <strong>For CSAM,</strong> we remove the content, report it to NCMEC or the
          relevant authority where required, and preserve the material and records
          as required by law. Preservation obligations survive account deletion.
        </li>
      </ul>
      <p>
        We may cooperate with law enforcement and disclose information as permitted
        or required by law. Enforcement decisions are at our reasonable discretion,
        prioritizing user safety and legal compliance.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update this policy as threats and the law evolve. Material changes
        take effect on posting with an updated effective date.
      </p>
    </LegalLayout>
  );
}
