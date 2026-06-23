import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Device-authorization approval page (RFC 8628 verification UI), behind the
 * `_authed` gate. The CLI prints a `user_code` + this URL; the operator signs in
 * (the gate), confirms the code, and approves — which stamps THIS account onto
 * the pending `deviceCodes` row so the CLI's next poll mints a scoped token.
 *
 * `verification_uri_complete` lands here with `?code=…` pre-filled. We call
 * `ensureAccount` first (idempotent) so a brand-new operator who lands here
 * before ever opening the dashboard still has an `accounts` row to approve with.
 */
export const Route = createFileRoute("/_authed/device")({
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
  component: DevicePage,
});

type Outcome = { kind: "approved" } | { kind: "denied" } | { kind: "error"; message: string };

function DevicePage() {
  const { code: initialCode } = Route.useSearch();
  const [code, setCode] = useState(initialCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const ensureAccount = useMutation(api.dashboard.ensureAccount);
  const approve = useMutation(api.device.approveDeviceCode);
  const deny = useMutation(api.device.denyDeviceCode);

  // Provision the operator's account row on first sign-in (idempotent), so
  // approve/deny never 403 with "No account".
  useEffect(() => {
    void ensureAccount({}).catch(() => {});
  }, [ensureAccount]);

  const trimmed = code.trim();
  const lookup = useQuery(
    api.device.lookupUserCode,
    trimmed ? { userCode: trimmed } : "skip",
  );

  async function onApprove() {
    setSubmitting(true);
    setOutcome(null);
    try {
      await approve({ userCode: trimmed });
      setOutcome({ kind: "approved" });
    } catch (err) {
      setOutcome({ kind: "error", message: errMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function onDeny() {
    setSubmitting(true);
    setOutcome(null);
    try {
      await deny({ userCode: trimmed });
      setOutcome({ kind: "denied" });
    } catch (err) {
      setOutcome({ kind: "error", message: errMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const found = lookup && lookup.found ? lookup : null;
  const notFound = trimmed.length > 0 && lookup && !lookup.found;
  const claimable = found && found.status === "pending" && !found.expired;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Shortwind Cloud</h1>
        <p className="sub">Approve a device</p>

        {outcome?.kind === "approved" ? (
          <div className="auth-ok" role="status">
            Approved. Return to your terminal — the CLI will finish signing in.
          </div>
        ) : outcome?.kind === "denied" ? (
          <div className="auth-error" role="status">
            Denied. The CLI request was rejected.
          </div>
        ) : outcome?.kind === "error" ? (
          <div className="auth-error" role="alert">
            {outcome.message}
          </div>
        ) : null}

        {!outcome ? (
          <>
            <div className="field">
              <label htmlFor="code">Device code</label>
              <input
                id="code"
                type="text"
                autoComplete="off"
                placeholder="ABCD-EFGH"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            {found ? (
              <div className="device-meta">
                <p>
                  A device wants to sign in as{" "}
                  <code>{found.clientId}</code>.
                </p>
                <p>
                  Requested access:{" "}
                  <strong>{found.scope || "(default scopes)"}</strong>
                </p>
                {found.status !== "pending" ? (
                  <p className="sub">Already {found.status}.</p>
                ) : found.expired ? (
                  <p className="sub">This code has expired — request a new one.</p>
                ) : null}
              </div>
            ) : notFound ? (
              <p className="sub">No matching device code. Check the code and try again.</p>
            ) : null}

            <div className="device-actions">
              <button
                type="button"
                className="btn"
                disabled={!claimable || submitting}
                onClick={onApprove}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={!found || submitting}
                onClick={onDeny}
              >
                Deny
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Surface a Convex error's message (the guard throws `ConvexError({message})`). */
function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      return String((data as { message?: unknown }).message);
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
