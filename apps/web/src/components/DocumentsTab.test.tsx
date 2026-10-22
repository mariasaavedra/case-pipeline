// @vitest-environment jsdom
// =============================================================================
// P3.6 — move by drag and drop, delete after a confirm
// =============================================================================
// Graph is mocked; what's under test is which Graph call a gesture makes: a row
// dropped on a folder row or on a folder in the path moves there, a file
// dropped from the desktop still uploads, and Delete asks before it deletes.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { DriveItem } from "../sharepoint/graph";

const mocks = vi.hoisted(() => ({
  resolveFolder: vi.fn(),
  listChildren: vi.fn(),
  moveItem: vi.fn(),
  deleteItem: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../api", () => ({ setProfileEFile: vi.fn() }));
vi.mock("./FilePreviewModal", () => ({ FilePreviewModal: () => null }));
vi.mock("../sharepoint/graph", () => {
  class GraphError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  }
  return {
    ...mocks,
    createFolder: vi.fn(),
    folderNameProblem: () => null,
    findOrCreateClientFolder: vi.fn(),
    getGraphToken: vi.fn(),
    GraphConsentRequiredError: class extends Error {},
    GraphError,
  };
});

import { DocumentsTab } from "./DocumentsTab";
import { GraphError } from "../sharepoint/graph";

const E_FILE = "https://sharmacrawford.sharepoint.com/sites/scalefiles/Shared Documents/L/LOPEZ, Ana";
const root = { driveId: "d1", itemId: "root", name: "LOPEZ, Ana", webUrl: E_FILE, isFolder: true };
const evidence: DriveItem = { id: "f-evidence", name: "Evidence", webUrl: "x", folder: { childCount: 3 } };
const empty: DriveItem = { id: "f-empty", name: "Old", webUrl: "x", folder: { childCount: 0 } };
const pdf: DriveItem = { id: "i-pdf", name: "I-589.pdf", webUrl: "x", size: 1200, file: {} };

let container: HTMLDivElement;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderInFolder(kids: DriveItem[] = [evidence, empty, pdf]) {
  mocks.resolveFolder.mockResolvedValue(root);
  mocks.listChildren.mockResolvedValue(kids);
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(<DocumentsTab data={{ profile: { eFile: E_FILE } }} />);
  });
  await act(async () => rowNamed("e-file").click());
  await flush();
}

function rowNamed(text: string): HTMLElement {
  const row = Array.from(container.querySelectorAll<HTMLElement>(".result-row")).find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`no row "${text}"`);
  return row;
}

function button(label: string, within: ParentNode = container): HTMLButtonElement {
  const b = Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(
    (x) => x.textContent?.trim() === label || x.getAttribute("aria-label") === label,
  );
  if (!b) throw new Error(`no button "${label}"`);
  return b;
}

/** jsdom has no DataTransfer — a plain stand-in carried on a plain Event. */
function fakeTransfer(types: string[]) {
  const data: Record<string, string> = {};
  return {
    types,
    files: [] as unknown as FileList,
    dropEffect: "none",
    effectAllowed: "all",
    setData(type: string, value: string) {
      data[type] = value;
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data[type] ?? "",
  };
}

function fire(el: Element, type: string, dataTransfer: ReturnType<typeof fakeTransfer>) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dataTransfer });
  el.dispatchEvent(ev);
}

async function dragRowOnto(source: HTMLElement, target: HTMLElement) {
  const dt = fakeTransfer([]);
  await act(async () => fire(source, "dragstart", dt));
  await act(async () => fire(target, "dragover", dt));
  await act(async () => fire(target, "drop", dt));
  await act(async () => fire(source, "dragend", dt));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("DocumentsTab — move", () => {
  it("moves a file dropped on a folder row into that folder", async () => {
    await renderInFolder();
    mocks.listChildren.mockResolvedValue([evidence, empty]);
    await dragRowOnto(rowNamed("I-589.pdf"), rowNamed("Evidence"));

    expect(mocks.moveItem).toHaveBeenCalledWith("d1", "i-pdf", "f-evidence");
    expect(container.textContent).toContain('Moved "I-589.pdf" to Evidence.');
    expect(() => rowNamed("I-589.pdf")).toThrow();
  });

  it("drops onto an ancestor in the breadcrumb", async () => {
    mocks.resolveFolder.mockResolvedValue(root);
    mocks.listChildren.mockResolvedValueOnce([evidence]).mockResolvedValueOnce([pdf]).mockResolvedValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(<DocumentsTab data={{ profile: { eFile: E_FILE } }} />);
    });
    await act(async () => rowNamed("e-file").click());
    await flush();
    await act(async () => rowNamed("Evidence").click());
    await flush();

    await dragRowOnto(rowNamed("I-589.pdf"), button("e-file"));
    expect(mocks.moveItem).toHaveBeenCalledWith("d1", "i-pdf", "root");
  });

  it("says so when the target already has a file of that name", async () => {
    await renderInFolder();
    mocks.moveItem.mockRejectedValueOnce(new GraphError(409, "nameAlreadyExists"));
    await dragRowOnto(rowNamed("I-589.pdf"), rowNamed("Evidence"));
    expect(container.textContent).toContain('There is already a "I-589.pdf" in Evidence.');
  });

  it("does not move a folder onto itself, and a drop from the desktop still uploads", async () => {
    await renderInFolder();
    await dragRowOnto(rowNamed("Evidence"), rowNamed("Evidence"));
    expect(mocks.moveItem).not.toHaveBeenCalled();

    const zone = Array.from(container.querySelectorAll("div")).find((d) => d.textContent?.startsWith("Drop files here"))!;
    const dt = fakeTransfer(["Files"]);
    const file = new File(["x"], "new.pdf");
    Object.defineProperty(dt, "files", { value: [file] });
    mocks.uploadFile.mockResolvedValue({ id: "n", name: "new.pdf", webUrl: "x" });
    await act(async () => fire(zone, "drop", dt));
    await flush();
    expect(mocks.uploadFile).toHaveBeenCalledWith("d1", "root", file, expect.any(Function));
    expect(mocks.moveItem).not.toHaveBeenCalled();
  });
});

describe("DocumentsTab — delete", () => {
  it("asks first, then deletes and refreshes", async () => {
    await renderInFolder();
    await act(async () => button("Delete I-589.pdf").click());
    expect(mocks.deleteItem).not.toHaveBeenCalled();

    mocks.listChildren.mockResolvedValue([evidence, empty]);
    await act(async () => button("Delete", rowNamed("I-589.pdf")).click());
    await flush();
    expect(mocks.deleteItem).toHaveBeenCalledWith("d1", "i-pdf");
    expect(container.textContent).toContain("recycle bin");
    expect(() => rowNamed("I-589.pdf")).toThrow();
  });

  it("Cancel keeps the file", async () => {
    await renderInFolder();
    await act(async () => button("Delete I-589.pdf").click());
    await act(async () => button("Cancel", rowNamed("I-589.pdf")).click());
    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(button("Delete I-589.pdf")).toBeTruthy();
  });

  it("offers Delete on empty folders only, never on a folder with files", async () => {
    await renderInFolder();
    expect(() => button("Delete Evidence")).toThrow();
    expect(button("Delete Old")).toBeTruthy();
  });

  it("pick mode has no delete and no dragging", async () => {
    mocks.resolveFolder.mockResolvedValue(root);
    mocks.listChildren.mockResolvedValue([evidence, pdf]);
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(
        <DocumentsTab data={{ profile: { eFile: E_FILE } }} pick={{ selected: new Set(), onToggle: () => {} }} />,
      );
    });
    await act(async () => rowNamed("e-file").click());
    await flush();
    expect(() => button("Delete I-589.pdf")).toThrow();
    expect(rowNamed("I-589.pdf").getAttribute("draggable")).toBe("false");
  });
});
