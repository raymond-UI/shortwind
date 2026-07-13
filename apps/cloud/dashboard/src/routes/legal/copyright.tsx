import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/LegalLayout";
import { LEGAL_CONFIG as C, legalEmail } from "@/config/legal";

export const Route = createFileRoute("/legal/copyright")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Copyright & Takedown Policy — Shortwind Cloud" },
      {
        name: "description",
        content:
          "How to report copyright infringement on Shortwind Cloud and our notice-and-takedown process.",
      },
    ],
  }),
  component: CopyrightPage,
});

function CopyrightPage() {
  return (
    <LegalLayout
      title="Copyright & Takedown Policy"
      summary="How to report content on Shortwind Cloud that infringes your copyright, and how our notice-and-takedown process works."
    >
      <h2>1. Our approach</h2>
      <p>
        We respect intellectual property rights and expect users of {C.serviceName}
        {" "}to do the same. As a hosting provider, we act on valid notices of
        infringing content and, in appropriate cases, disable access to it and
        act against repeat infringers. This reflects our obligations and hosting-
        liability protections as an intermediary under applicable law (including,
        in the UK, the Electronic Commerce (EC Directive) Regulations 2002, and, for
        users in the EU, the Digital Services Act).
      </p>

      <h2>2. Who to contact</h2>
      <p>Send copyright complaints and takedown requests to:</p>
      <ul>
        <li>
          <strong>{C.copyrightAgent.name}</strong>
        </li>
        <li>
          <strong>{C.copyrightAgent.address}</strong>
        </li>
        <li>
          Email:{" "}
          <a href={`mailto:${legalEmail("copyright")}`}>
            {legalEmail("copyright")}
          </a>
        </li>
      </ul>

      <h2>3. How to file a takedown notice</h2>
      <p>
        To help us act quickly, please include the following in your notice:
      </p>
      <ol>
        <li>
          Your name and contact details, and, if you are acting for the rights
          holder, who you represent.
        </li>
        <li>
          Identification of the copyrighted work(s) you say have been infringed
          (or a representative list).
        </li>
        <li>
          The exact location of the infringing material — the page URL(s) on the
          Service — with enough detail for us to find it.
        </li>
        <li>
          A statement that you have a good-faith belief the use is not authorised by
          the rights holder, its agent, or the law.
        </li>
        <li>
          A statement that the information in your notice is accurate, and that you
          are the rights holder or authorised to act on their behalf.
        </li>
        <li>Your electronic or physical signature.</li>
      </ol>
      <p>
        Please submit complaints in good faith. Knowingly making a materially false
        claim of infringement may expose you to liability for any resulting loss.
      </p>

      <h2>4. What we do with a valid notice</h2>
      <p>
        When we receive a complete, good-faith notice, we will act expeditiously to
        remove or disable access to the identified material, and we will make a
        reasonable effort to notify the user who published it, including a copy of
        the complaint. We may record the complaint against the user’s account for the
        purposes of our repeat-infringer policy.
      </p>

      <h2>5. If your content was removed (counter-notice)</h2>
      <p>
        If your content was removed and you believe that was a mistake or that you
        are authorised to use the material, you may object by writing to the contact
        above with:
      </p>
      <ol>
        <li>Your name and contact details.</li>
        <li>
          Identification of the material that was removed and the URL where it
          appeared.
        </li>
        <li>
          A statement, made in good faith, explaining why you believe the material
          should be restored (for example that it is your own work, licensed, or
          covered by an exception such as fair dealing).
        </li>
        <li>Your electronic or physical signature.</li>
      </ol>
      <p>
        We will review your objection and, where appropriate, restore the material or
        put you and the complainant in contact to resolve the dispute. We are not a
        court and do not adjudicate the underlying rights; unresolved disputes may
        need to be settled between the parties or through legal process.
      </p>

      <h2>6. Repeat infringers</h2>
      <p>
        We will, in appropriate circumstances and at our discretion, restrict, disable,
        or terminate the accounts of users who are the subject of repeated valid
        infringement complaints.
      </p>

      <h2>7. Other complaints</h2>
      <p>
        For non-copyright complaints (for example trademark, privacy, or the content
        types in our <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>),
        contact <a href={`mailto:${legalEmail("abuse")}`}>{legalEmail("abuse")}</a>.
      </p>
    </LegalLayout>
  );
}
