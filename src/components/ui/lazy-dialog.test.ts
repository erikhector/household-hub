import { describe, expect, it, vi } from "vitest";
import { createLazyDialogLoader, openLazyDialog } from "./lazy-dialog";
import type { DialogHandle } from "./dialog";

describe("createLazyDialogLoader", () => {
  it("imports once and shares the component", async () => {
    const Component = () => null;
    const importer = vi.fn(async () => Component);
    const loader = createLazyDialogLoader(importer);

    expect(loader.get()).toBeUndefined();
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(Component);
    expect(b).toBe(Component);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(loader.get()).toBe(Component);
  });

  it("retries after a failed import instead of caching the failure", async () => {
    const Component = () => null;
    const importer = vi
      .fn<() => Promise<typeof Component>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Component);
    const loader = createLazyDialogLoader(importer);

    await expect(loader.load()).rejects.toThrow("offline");
    expect(loader.get()).toBeUndefined();
    await expect(loader.load()).resolves.toBe(Component);
  });

  it("preload never throws on a failed import", async () => {
    const loader = createLazyDialogLoader(() => Promise.reject(new Error("offline")));
    expect(() => loader.preload()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe("openLazyDialog", () => {
  it("opens a handle with no lazy host straight through the handle", () => {
    const handle = { open: vi.fn() } as unknown as DialogHandle;
    openLazyDialog(handle);
    expect(handle.open).toHaveBeenCalledWith(null);
  });
});
