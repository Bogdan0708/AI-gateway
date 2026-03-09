import { ErrorCodes } from "./error-codes";

export function getRequestErrorResponse(error: unknown):
  | { statusCode: number; message: string; code: string }
  | null {
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    return {
      statusCode: 413,
      message: "request body is too large",
      code: ErrorCodes.requestBodyTooLarge,
    };
  }

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    return {
      statusCode: 400,
      message: "request body contains invalid JSON",
      code: ErrorCodes.requestInvalidJson,
    };
  }

  return null;
}
