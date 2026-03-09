import { describe, expect, it } from "vitest";
import { getRequestErrorResponse } from "../lib/request-errors";

describe("request error mapping", () => {
  it("maps oversized request bodies to 413", () => {
    expect(
      getRequestErrorResponse({ type: "entity.too.large" }),
    ).toEqual({
      statusCode: 413,
      message: "request body is too large",
      code: "request.body_too_large",
    });
  });

  it("maps malformed JSON to 400", () => {
    const error = new SyntaxError("Unexpected token");
    Object.assign(error, { status: 400 });

    expect(getRequestErrorResponse(error)).toEqual({
      statusCode: 400,
      message: "request body contains invalid JSON",
      code: "request.invalid_json",
    });
  });

  it("returns null for non-request errors", () => {
    expect(getRequestErrorResponse(new Error("boom"))).toBeNull();
  });
});
