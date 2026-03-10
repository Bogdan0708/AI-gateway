export function sanitizeProviderError(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "provider request timed out";
  }

  if (error instanceof Error) {
    return error.message.replace(/\s+/g, " ").trim().slice(0, 200);
  }

  return "AI request failed";
}
