import { describe, expect, it, vi } from "vitest";
import { authMiddleware } from "../middleware/auth";

describe("auth middleware", () => {
  it("allows readiness probes without authentication", () => {
    const next = vi.fn();
    const status = vi.fn();
    const json = vi.fn();

    authMiddleware(
      {
        path: "/ready",
        headers: {},
      } as never,
      {
        status,
        json,
      } as never,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
