import { useState } from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

/**
 * Operator signup (email + password). Email verification is OFF on the backend
 * (no SMTP), so a freshly-created operator is signed in immediately. On success
 * we invalidate + navigate to the dashboard, where `ensureAccount` provisions
 * the operator's account row on first load.
 */
export const Route = createFileRoute("/signup")({
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: "/dashboard" });
  },
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !submitting && email.length > 0 && password.length >= 8;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const res = await authClient.signUp.email({
      email,
      password,
      name: name || email,
    });
    if (res.error) {
      setError(res.error.message ?? "Sign up failed.");
      setSubmitting(false);
      return;
    }
    await router.invalidate();
    await router.navigate({ to: "/dashboard" });
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Shortwind Cloud</h1>
        <p className="sub">Create an operator account</p>
        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
            <label htmlFor="password">Password (min 8 chars)</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn" type="submit" disabled={!canSubmit}>
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="auth-foot">
          By creating an account you agree to our{" "}
          <Link to="/legal/terms">Terms</Link> and{" "}
          <Link to="/legal/privacy">Privacy Policy</Link>.
        </p>
        <p className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
