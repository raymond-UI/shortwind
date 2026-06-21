import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./convex/auth-client";
import { ConvexDataProvider } from "./convex/provider";
import { App } from "./App";
import "./styles.css";

/**
 * Dashboard entry (CLOUD-35). Wires, top-down:
 *   ConvexReactClient (VITE_CONVEX_URL)
 *     → ConvexBetterAuthProvider (operator session)
 *       → ConvexDataProvider (the five reactive oversight queries → DashboardData)
 *         → App (the five views)
 *
 * CLOUD-30b supplies the live `VITE_CONVEX_URL` + Better Auth origin + the
 * operator read bearer. Offline this still builds; with no URL the client is
 * created against an empty string and the queries stay in their loading branch.
 */
const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";
const convex = new ConvexReactClient(convexUrl);

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("missing #root element");
}

createRoot(rootEl).render(
  <StrictMode>
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <ConvexDataProvider>
        <App />
      </ConvexDataProvider>
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
