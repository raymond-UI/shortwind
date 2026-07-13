import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/LegalLayout";

export const Route = createFileRoute("/legal/dmca")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Copyright / DMCA Policy — Shortwind Cloud" },
      {
        name: "description",
        content:
          "How to report copyright infringement on Shortwind Cloud and our notice-and-takedown process.",
      },
    ],
  }),
  component: DmcaPage,
});

function DmcaPage() {
  return (
    <LegalLayout
      title="Copyright / DMCA Policy"
      summary="How to report copyright infringement on Shortwind Cloud, how counter-notices work, and our repeat-infringer policy."
    >
      <h2>1. Our policy</h2>
      <p>
        We respect the intellectual property rights of others and expect users to do
        the same. We respond to clear notices of alleged copyright infringement under
        the U.S. Digital Millennium Copyright Act (DMCA) and comparable laws, and we
        terminate the accounts of repeat infringers in appropriate circumstances.
      </p>

      <h2>2. Designated agent</h2>
      <p>
        Send copyright notices to our designated agent:
      </p>
      <ul>
        <li>
          <strong>[DMCA Agent Name]</strong>
        </li>
        <li>
          <strong>[Operator Legal Entity]</strong>
        </li>
        <li>
          <strong>[DMCA Agent Mailing Address]</strong>
        </li>
        <li>
          Email: <a href="mailto:[dmca@your-domain]">[dmca@your-domain]</a>
        </li>
      </ul>
      <p>
        In the United States, register your designated agent with the U.S. Copyright
        Office to be eligible for the DMCA safe harbor:{" "}
        <strong>[Copyright Office agent registration reference]</strong>.
      </p>

      <h2>3. How to file a takedown notice</h2>
      <p>
        To be effective, a notice must be a written communication that includes
        substantially the following (17 U.S.C. § 512(c)(3)):
      </p>
      <ol>
        <li>
          Your physical or electronic signature (the owner or a person authorized to
          act for the owner).
        </li>
        <li>
          Identification of the copyrighted work claimed to be infringed.
        </li>
        <li>
          Identification of the material claimed to be infringing, with enough detail
          for us to locate it — including the page URL(s) on the Service.
        </li>
        <li>Your contact information (address, telephone number, and email).</li>
        <li>
          A statement that you have a good-faith belief that the use is not
          authorized by the copyright owner, its agent, or the law.
        </li>
        <li>
          A statement, under penalty of perjury, that the information in the notice is
          accurate and that you are the owner or authorized to act on the owner’s
          behalf.
        </li>
      </ol>
      <p>
        Note: under 17 U.S.C. § 512(f), knowingly materially misrepresenting that
        material is infringing can subject you to liability.
      </p>

      <h2>4. What we do with a valid notice</h2>
      <p>
        On receipt of a compliant notice, we will remove or disable access to the
        identified material and make a reasonable effort to notify the affected user,
        including a copy of the notice. We may also note the complaint against the
        user’s account for our repeat-infringer policy.
      </p>

      <h2>5. Counter-notification</h2>
      <p>
        If your content was removed and you believe that was a mistake or
        misidentification, you may send a counter-notice to our designated agent
        including substantially the following (17 U.S.C. § 512(g)):
      </p>
      <ol>
        <li>Your physical or electronic signature.</li>
        <li>
          Identification of the material that was removed and the location where it
          appeared before removal.
        </li>
        <li>
          A statement, under penalty of perjury, that you have a good-faith belief the
          material was removed as a result of mistake or misidentification.
        </li>
        <li>
          Your name, address, and telephone number, and a statement that you consent
          to the jurisdiction of the federal court for your district (or, if outside
          the U.S., a district in which we may be found), and that you will accept
          service of process from the person who filed the notice.
        </li>
      </ol>
      <p>
        If we receive a valid counter-notice, we may restore the material in 10–14
        business days unless the original complainant notifies us that they have filed
        a court action seeking to restrain the activity.
      </p>

      <h2>6. Repeat infringers</h2>
      <p>
        We will, in appropriate circumstances and at our discretion, disable or
        terminate the accounts of users who are the subject of repeated valid
        infringement notices.
      </p>

      <h2>7. Other rights and abuse</h2>
      <p>
        For non-copyright complaints (for example trademark, privacy, or the content
        types in our <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>),
        contact <a href="mailto:[abuse@your-domain]">[abuse@your-domain]</a>.
      </p>
    </LegalLayout>
  );
}
