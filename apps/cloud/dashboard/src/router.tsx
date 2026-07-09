import { createRouter } from "@tanstack/react-router";
import {
  QueryClient,
  dehydrate,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { routeTree } from "./routeTree.gen";
import { RouteError, RouteNotFound } from "./components/RouteError";

/**
 * Router factory (mirrors nyxe-mail/apps/web/src/router.tsx). Wires a Convex
 * query client into TanStack Query so route components can `useQuery(convexQuery
 * (api.dashboard.*))` and have the dehydrated SSR cache hydrate on the client.
 */
export function getRouter() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
  });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        refetchOnWindowFocus: false,
      },
    },
  });
  convexQueryClient.connect(queryClient);

  const router = createRouter({
    routeTree,
    // Served under `/cloud` (routed at https://shortwind.dev/cloud). The
    // TanStack Start plugin also injects this from Vite `base` via the
    // `TSS_ROUTER_BASEPATH` define (router.update on SSR + hydration), but we
    // set it explicitly so the router is correct even outside that injection.
    basepath: "/cloud",
    scrollRestoration: true,
    // Themed boundaries in place of TanStack's raw "Something went wrong!"
    // default (which leaked Convex "Server Error" strings full-bleed).
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
    context: {
      queryClient,
      convexQueryClient,
    },
    dehydrate: (() => ({
      queryClientState: dehydrate(queryClient),
    })) as unknown as never,
    hydrate: ((dehydrated: { queryClientState: DehydratedState }) => {
      hydrate(queryClient, dehydrated.queryClientState);
    }) as unknown as never,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
