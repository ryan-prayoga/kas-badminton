import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_ERROR_STATUS,
  NETWORK_ERROR,
  TIMEOUT_ERROR,
  safeAction,
  type ActionResult,
} from "./action-result";

const ok: ActionResult<string> = { ok: true, data: "ok" };

describe("safeAction", () => {
  it("meneruskan hasil sukses apa adanya", async () => {
    await expect(safeAction(async () => ok)).resolves.toEqual(ok);
  });

  it("meneruskan error dari server apa adanya", async () => {
    const err: ActionResult<string> = { ok: false, error: "Nama sudah dipakai", status: 409 };
    await expect(safeAction(async () => err)).resolves.toEqual(err);
  });

  it("menurunkan reject jaringan jadi ActionResult error", async () => {
    await expect(
      safeAction<string>(() => Promise.reject(new TypeError("Load failed"))),
    ).resolves.toEqual({ ok: false, error: NETWORK_ERROR, status: CLIENT_ERROR_STATUS });
  });

  it("berhenti nunggu kalau request nggantung", async () => {
    vi.useFakeTimers();
    try {
      const p = safeAction<string>(() => new Promise(() => {}), 20_000);
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(p).resolves.toEqual({
        ok: false,
        error: TIMEOUT_ERROR,
        status: CLIENT_ERROR_STATUS,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reject yang datang setelah timeout tidak jadi unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let fail!: (e: unknown) => void;
      const p = safeAction<string>(
        () => new Promise((_, reject) => (fail = reject)),
        1, // langsung timeout
      );
      await expect(p).resolves.toMatchObject({ ok: false, error: TIMEOUT_ERROR });
      fail(new TypeError("Load failed"));
      // beri kesempatan event loop melaporkan rejection kalau memang bocor
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
