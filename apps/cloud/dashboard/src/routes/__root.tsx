/// <reference types="vite/client" />
import type { ReactNode } from "react";
import {
  Outlet,
  createRootRouteWithContext,
  useRouteContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import { authClient } from "@/lib/auth-client";
import { getToken } from "@/lib/auth-server";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import appCss from "../index.css?url";

/**
 * Root route (mirrors nyxe-mail/apps/web/src/routes/__root.tsx, trimmed to the
 * web-only path).
 *
 * `beforeLoad` runs a server fn that reads the operator's Convex JWT from the
 * request cookies; when present it seeds the SSR Convex client so authed queries
 * resolve during render. `isAuthenticated` (session presence) is the gate the
 * `_authed` layout reads. The component wraps everything in the React Query +
 * Convex Better Auth providers so route components can `useQuery(convexQuery(...))`.
 */
const getAuth = createServerFn({ method: "GET" }).handler(async () => {
  return await getToken();
});

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  convexQueryClient: ConvexQueryClient;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#0a0a0a" },
      { title: "Shortwind Cloud" },
    ],
    // Favicons: the dashboard shares the `shortwind.dev` origin with the Astro
    // site, so we reference the site's already-deployed icon set at the domain
    // root (no asset duplication). This gives every dashboard page — including
    // the public /cloud landing — the shortwind ▚ favicon.
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { rel: "icon", href: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  beforeLoad: async (ctx) => {
    const token = await getAuth();
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token);
    }
    return { isAuthenticated: !!token, token };
  },
  component: RootComponent,
});

function RootComponent() {
  const context = useRouteContext({ from: Route.id });
  return (
    <RootDocument>
      <QueryClientProvider client={context.queryClient}>
        <ConvexBetterAuthProvider
          client={context.convexQueryClient.convexClient}
          authClient={authClient}
          initialToken={context.token}
        >
          <Outlet />
        </ConvexBetterAuthProvider>
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // `suppressHydrationWarning`: the pre-hydration script below sets the `.dark`
    // class from the saved/OS preference, so the class is intentionally not
    // managed by React (next-themes pattern) — don't warn on the mismatch.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the theme before first paint to avoid a flash (epic #184). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
