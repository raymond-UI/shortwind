import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithData } from "../test/render";
import { UploadPageDialog } from "./UploadPageDialog";

/**
 * Upload-to-publish flow (feature 1). Drives the dialog through the data seam's
 * `publishPage` fake: pick an .html file → Publish → success URL. Also covers
 * the taken-slug (409) and validation branches.
 */

/** A File whose `text()` is explicit, so the read doesn't depend on jsdom Blob. */
function htmlFile(name: string, html: string): File {
  const f = new File([html], name, { type: "text/html" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(html) });
  return f;
}

function pick(file: File) {
  // Dialog renders in a portal, so query the whole document (not the container).
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("UploadPageDialog", () => {
  it("uploads a file and publishes to a live URL", async () => {
    const publishPage = vi.fn(async () => ({
      ok: true as const,
      id: "pg_1",
      url: "https://my-page.shortwind.app",
      version: 1,
    }));
    renderWithData(
      <UploadPageDialog open onClose={() => {}} />,
      { publishPage },
    );

    pick(htmlFile("index.html", "<h1>Hello</h1>"));
    // The dropzone shows the chosen file name; Publish becomes enabled.
    expect(await screen.findByText("index.html")).toBeInTheDocument();
    const publishBtn = screen.getByTestId("upload-publish");
    await waitFor(() => expect(publishBtn).not.toBeDisabled());

    fireEvent.click(publishBtn);

    expect(await screen.findByTestId("upload-done")).toBeInTheDocument();
    expect(screen.getByText("https://my-page.shortwind.app")).toBeInTheDocument();
    expect(publishPage).toHaveBeenCalledWith({
      html: "<h1>Hello</h1>",
      slug: undefined,
      visibility: "public",
    });
  });

  it("keeps focus in the address field while typing (no cursor jump)", async () => {
    renderWithData(<UploadPageDialog open onClose={() => {}} />, {
      publishPage: vi.fn(),
    });
    pick(htmlFile("index.html", "<h1>Hi</h1>"));
    await screen.findByText("index.html");
    const input = screen.getByLabelText("Page address slug") as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
    // A keystroke re-renders the dialog; the Dialog must NOT re-focus its panel
    // and steal the cursor (the reported bug).
    fireEvent.change(input, { target: { value: "l" } });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "lc" } });
    expect(document.activeElement).toBe(input);
  });

  it("surfaces a taken-slug 409 without crashing", async () => {
    const publishPage = vi.fn(async () => ({
      ok: false as const,
      status: 409 as const,
      existingId: "pg_existing",
    }));
    renderWithData(
      <UploadPageDialog open onClose={() => {}} />,
      { publishPage },
    );
    pick(htmlFile("index.html", "<h1>Hi</h1>"));
    await screen.findByText("index.html");
    fireEvent.click(screen.getByTestId("upload-publish"));
    expect(await screen.findByTestId("upload-error")).toHaveTextContent(/taken/i);
  });

  it("rejects an invalid address client-side (friendly, no server call)", async () => {
    const publishPage = vi.fn();
    renderWithData(<UploadPageDialog open onClose={() => {}} />, { publishPage });
    pick(htmlFile("index.html", "<h1>Hi</h1>"));
    await screen.findByText("index.html");
    fireEvent.change(screen.getByLabelText("Page address slug"), {
      target: { value: "LC" }, // uppercase → invalid slug
    });
    fireEvent.click(screen.getByTestId("upload-publish"));
    expect(await screen.findByTestId("upload-error")).toHaveTextContent(
      /lowercase/i,
    );
    expect(publishPage).not.toHaveBeenCalled();
  });

  it("rejects a non-HTML file before any publish", async () => {
    const publishPage = vi.fn();
    renderWithData(
      <UploadPageDialog open onClose={() => {}} />,
      { publishPage },
    );
    const png = new File(["not html"], "photo.png", { type: "image/png" });
    Object.defineProperty(png, "text", { value: () => Promise.resolve("x") });
    pick(png);
    // .png name → rejected; the file is not accepted and publish stays disabled.
    expect(await screen.findByTestId("upload-error")).toHaveTextContent(/\.html/i);
    expect(screen.getByTestId("upload-publish")).toBeDisabled();
    expect(publishPage).not.toHaveBeenCalled();
  });
});
