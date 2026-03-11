const READINESS_TIMEOUT_MS = 2_000;

interface ProbeUrlOptions {
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
}

export async function probeUrl(
  url: string,
  options: ProbeUrlOptions = {},
): Promise<{
  ready: boolean;
  reason?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      signal: controller.signal,
      redirect: "manual",
    });

    const ready = response.status >= 200 && response.status < 400;

    return {
      ready,
      reason: ready
        ? `reachable (${response.status})`
        : `unexpected status (${response.status})`,
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
