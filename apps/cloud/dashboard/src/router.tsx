import { createRouter } from "@tanstack/react-router";
import {
  QueryClient,
  dehydrate,
  hydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { ConvexQueryClient } from "@convex-dev/react-query";
import { routeTree } from "./routeTree.gen";

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
    scrollRestoration: true,
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
