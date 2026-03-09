const READINESS_TIMEOUT_MS = 2_000;

export async function probeUrl(url: string): Promise<{
  ready: boolean;
  reason?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });

    return {
      ready: true,
      reason: `reachable (${response.status})`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ready: false, reason: "probe timed out" };
    }

    return {
      ready: false,
      reason: error instanceof Error ? error.message : "probe failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
