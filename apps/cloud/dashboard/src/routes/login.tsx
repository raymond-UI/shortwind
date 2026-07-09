import { useState } from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

/**
 * Operator login (email + password). Mirrors nyxe-mail's login: on success it
 * invalidates the router so `__root.beforeLoad` re-reads the (now-present)
 * session, then navigates to the dashboard. A logged-in visitor is bounced
 * straight to the dashboard.
 */
export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    // Redirect straight to the resolved section, not the bare `/dashboard`
    // (which itself redirects to `/overview`) — routing through `/dashboard`
    // added an extra history hop and made the URL bounce after login.
    if (context.isAuthenticated) {
      throw redirect({ to: "/dashboard/$section", params: { section: "overview" } });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && email.length > 0 && password.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const res = await authClient.signIn.email({ email, password });
    if (res.error) {
      setError(res.error.message ?? "Sign in failed. Check your credentials.");
      setSubmitting(false);
      return;
    }
    await router.invalidate();
    await router.navigate({
      to: "/dashboard/$section",
      params: { section: "overview" },
    });
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Shortwind Cloud</h1>
        <p className="sub">Operator sign in</p>
        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={!canSubmit}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="auth-foot">
          No account? <Link to="/signup">Create one</Link>
        </p>
      </div>
    </div>
  );
}
