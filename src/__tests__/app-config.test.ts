import { describe, expect, it, vi } from "vitest";

vi.mock("../providers", () => ({
  complete: vi.fn(),
  CompletionRoutingError: class CompletionRoutingError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.name = "CompletionRoutingError";
      this.statusCode = statusCode;
    }
  },
  listProviders: vi.fn(() => []),
}));

process.env.GATEWAY_MASTER_KEY = "test-key-for-unit-tests";

import { app } from "../index";

describe("app configuration", () => {
  it("trusts the first proxy hop for Cloud Run", () => {
    expect(app.get("trust proxy")).toBe(1);
  });
});
