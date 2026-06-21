import { createContext, useContext } from "react";
import type { DashboardData } from "./types";

/**
 * The dashboard's data seam (CLOUD-35).
 *
 * Views consume the oversight dataset through this context, NEVER by calling
 * Convex directly. That seam is the whole testability story: the live provider
 * (`ConvexDataProvider`, src/convex/provider.tsx) fills the context from
 * `useQuery(api.dashboard.*)`; component tests wrap views in a plain
 * `DataContext.Provider` with fixture data. No view imports the Convex client,
 * so tests need no live deployment and no deep client mock.
 */
const DashboardDataContext = createContext<DashboardData | null>(null);

export const DashboardDataProvider = DashboardDataContext.Provider;

export function useDashboardData(): DashboardData {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error(
      "useDashboardData must be used within a DashboardDataProvider",
    );
  }
  return ctx;
}
