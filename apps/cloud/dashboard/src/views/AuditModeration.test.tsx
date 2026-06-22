import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { AuditView } from "./AuditView";
import { ModerationView } from "./ModerationView";
import { renderWithData } from "../test/render";

describe("AuditView (PRD §6.3 actor/action feed)", () => {
  it("renders one row per audit event with its action", () => {
    renderWithData(<AuditView />);
    const rows = screen.getAllByTestId("audit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("page.publish")).toBeInTheDocument();
    expect(screen.getByText("page.delete")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    renderWithData(<AuditView />, { auditLog: [] });
    expect(screen.getByText(/No audit events yet/)).toBeInTheDocument();
  });
});

describe("ModerationView (PRD §8 abuse/quarantine queue)", () => {
  it("renders reported/quarantined cases with the preserved sealed key", () => {
    renderWithData(<ModerationView />);
    const rows = screen.getAllByTestId("moderation-row");
    expect(rows).toHaveLength(1);
    expect(screen.getByText("quarantined")).toBeInTheDocument();
    // Preserve-not-delete (§8.2): the sealed-store pointer is surfaced.
    expect(screen.getByText(/sealed: sealed\/page_9/)).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    renderWithData(<ModerationView />, { moderation: [] });
    expect(screen.getByText(/No moderation cases/)).toBeInTheDocument();
  });
});
