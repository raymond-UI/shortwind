import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { DashboardDataProvider } from "../lib/data";
import type { DashboardData } from "../lib/types";
import { makeData } from "./fixtures";

/**
 * Render a view inside a mock `DashboardDataProvider` (CLOUD-35 tests). No
 * Convex client — the views consume the data seam, so fixtures are all they
 * need.
 */
export function renderWithData(
  ui: ReactElement,
  data: Partial<DashboardData> = {},
) {
  const value = makeData(data);
  return {
    value,
    ...render(
      <DashboardDataProvider value={value}>{ui}</DashboardDataProvider>,
    ),
  };
}
