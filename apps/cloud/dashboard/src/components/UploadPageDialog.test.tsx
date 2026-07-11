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

/** Pick multiple files at once (the multi-file / folder-browse path). */
function pickMany(files: File[]) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
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
    // Address left blank → defaulted from the file name ("index.html" → "index").
    expect(publishPage).toHaveBeenCalledWith({
      html: "<h1>Hello</h1>",
      slug: "index",
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

  it("pre-fills the address from the file name (normalized)", async () => {
    const publishPage = vi.fn(async () => ({
      ok: true as const,
      id: "pg_1",
      url: "https://managers-calendar-july-2026.shortwind.app",
      version: 1,
    }));
    renderWithData(<UploadPageDialog open onClose={() => {}} />, { publishPage });
    pick(htmlFile("Managers Calendar July 2026.html", "<h1>Cal</h1>"));
    await screen.findByText("Managers Calendar July 2026.html");
    const input = screen.getByLabelText("Page address slug") as HTMLInputElement;
    expect(input.value).toBe("managers-calendar-july-2026");
    fireEvent.click(screen.getByTestId("upload-publish"));
    await screen.findByTestId("upload-done");
    expect(publishPage).toHaveBeenCalledWith({
      html: "<h1>Cal</h1>",
      slug: "managers-calendar-july-2026",
      visibility: "public",
    });
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

  it("normalizes a messy address instead of erroring", async () => {
    const publishPage = vi.fn(async (input: { slug?: string }) => ({
      ok: true as const,
      id: "pg",
      url: `https://${input.slug}.shortwind.app`,
      version: 1,
    }));
    renderWithData(<UploadPageDialog open onClose={() => {}} />, { publishPage });
    pick(htmlFile("index.html", "<h1>Hi</h1>"));
    await screen.findByText("index.html");
    const input = screen.getByLabelText("Page address slug") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Aceme Dashboard" } });
    // On blur the field shows the normalized form.
    fireEvent.blur(input);
    expect(input.value).toBe("aceme-dashboard");
    fireEvent.click(screen.getByTestId("upload-publish"));
    await screen.findByTestId("upload-done");
    expect(publishPage).toHaveBeenCalledWith({
      html: "<h1>Hi</h1>",
      slug: "aceme-dashboard",
      visibility: "public",
    });
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

  it("publishes multiple files with index.html as one linked bundle", async () => {
    const publishBundle = vi.fn(
      async (input: { files: { path: string }[]; entryPath: string }) => {
        void input;
        return {
          ok: true as const,
          bundleId: "site",
          url: "https://site.shortwind.app",
          version: 1,
        };
      },
    );
    renderWithData(<UploadPageDialog open onClose={() => {}} />, { publishBundle });
    pickMany([
      htmlFile("index.html", "<h1>Home</h1>"),
      htmlFile("about.html", "<h1>About</h1>"),
    ]);
    // index.html present → the bundle toggle appears AND is auto-checked.
    expect(await screen.findByTestId("upload-bundle-toggle")).toBeChecked();
    fireEvent.click(screen.getByTestId("upload-publish"));
    await screen.findByTestId("upload-done");
    expect(publishBundle).toHaveBeenCalledTimes(1);
    const arg = publishBundle.mock.calls[0]![0];
    expect(arg.entryPath).toBe("index.html");
    expect(arg.files.map((f) => f.path).sort()).toEqual(["about.html", "index.html"]);
  });

  it("does NOT default to a bundle when there's no index.html", async () => {
    const publishPage = vi.fn(async (input: { slug?: string }) => ({
      ok: true as const,
      id: "pg",
      url: `https://${input.slug}.shortwind.app`,
      version: 1,
    }));
    const publishBundle = vi.fn();
    renderWithData(<UploadPageDialog open onClose={() => {}} />, {
      publishPage,
      publishBundle,
    });
    pickMany([
      htmlFile("alpha.html", "<h1>A</h1>"),
      htmlFile("beta.html", "<h1>B</h1>"),
    ]);
    // No index.html → the toggle is offered but UNchecked (separate pages).
    expect(await screen.findByTestId("upload-bundle-toggle")).not.toBeChecked();
    fireEvent.click(screen.getByTestId("upload-publish"));
    await screen.findByTestId("upload-done");
    expect(publishBundle).not.toHaveBeenCalled();
    expect(publishPage).toHaveBeenCalledTimes(2);
    expect(publishPage.mock.calls.map((c) => (c[0] as { slug?: string }).slug).sort()).toEqual(
      ["alpha", "beta"],
    );
  });

  it("lets you choose the entry page when there's no index.html", async () => {
    const publishBundle = vi.fn(
      async (input: { entryPath: string }) => {
        void input;
        return {
          ok: true as const,
          bundleId: "site",
          url: "https://site.shortwind.app",
          version: 1,
        };
      },
    );
    renderWithData(<UploadPageDialog open onClose={() => {}} />, { publishBundle });
    pickMany([
      htmlFile("home.html", "<h1>Home</h1>"),
      htmlFile("two.html", "<h1>2</h1>"),
    ]);
    // Default is separate (no index); opt into a bundle → the entry Select
    // appears (custom dropdown). Open it and choose "two.html" as the root.
    fireEvent.click(await screen.findByTestId("upload-bundle-toggle"));
    fireEvent.click(await screen.findByTestId("upload-entry")); // open the dropdown
    fireEvent.click(screen.getByRole("option", { name: /two\.html/ }));
    expect(screen.getByTestId("upload-publish")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("upload-publish"));
    await screen.findByTestId("upload-done");
    expect(publishBundle.mock.calls[0]![0].entryPath).toBe("two.html");
  });
});
