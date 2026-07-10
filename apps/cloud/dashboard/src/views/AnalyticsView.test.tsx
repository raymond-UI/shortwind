import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { AnalyticsView } from "./AnalyticsView";
import { renderWithData } from "../test/render";
import type { AuditRow } from "../lib/types";

const now = Date.now();
const HOUR = 3600e3;
const DAY = 24 * HOUR;

function publishEvent(id: string, createdAt: number): AuditRow {
  return {
    id,
    action: "page.publish",
    targetId: "page_1",
    actorTokenId: "tok_1",
    metadata: {},
    createdAt,
  };
}

describe("AnalyticsView (activity from real account data)", () => {
  it("totals recent publishes and ignores other actions", () => {
    renderWithData(<AnalyticsView />, {
      auditLog: [
        publishEvent("a1", now - 2 * HOUR),
        publishEvent("a2", now - 3 * HOUR),
        publishEvent("a3", now - 5 * DAY),
        {
          id: "a4",
          action: "page.delete",
          targetId: "page_2",
          actorTokenId: "tok_1",
          metadata: {},
          createdAt: now - HOUR,
        },
      ],
    });
    expect(screen.getByTestId("publish-total")).toHaveTextContent("3");
  });

  it("breaks pages down by lifecycle, hiding zero rows except live", () => {
    renderWithData(<AnalyticsView />);
    // Fixtures: 1 active + 1 tombstoned, no quarantined.
    expect(screen.getByTestId("lifecycle-live")).toHaveTextContent("1");
    expect(screen.getByTestId("lifecycle-tombstoned")).toHaveTextContent("1");
    expect(screen.queryByTestId("lifecycle-quarantined")).not.toBeInTheDocument();
  });

  it("lists recently updated pages and opens one on click", () => {
    const onOpenPage = vi.fn();
    renderWithData(<AnalyticsView onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByRole("button", { name: /launch/ }));
    expect(onOpenPage).toHaveBeenCalledWith("page_1");
  });

  it("keeps card titles visible while data loads", () => {
    renderWithData(<AnalyticsView />, { auditLog: undefined, pages: undefined });
    expect(screen.getByText("Publish activity")).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /loading analytics/i }),
    ).toBeInTheDocument();
  });
});
