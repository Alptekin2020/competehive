// ============================================
// Direct (proxy-bypassing) fetch for first-party API calls
// ============================================
//
// index.ts routes ALL outbound fetch through the scraping proxy
// (setGlobalDispatcher) so marketplace pages see a rotating IP. API providers
// (Serper, OpenAI) do not need that — and the proxy is the least reliable hop
// in the chain: prod logs show competitor searches dying with "Proxy response
// (502) !== 200 when HTTP Tunneling" / "fetch failed" / "terminated" several
// times a day, each one costing a product its whole discovery round.
//
// directFetch uses its own undici Agent, so these calls never touch the proxy.

import { Agent, fetch as undiciFetch } from "undici";

let directAgent: Agent | null = null;

function getDirectAgent(): Agent {
  if (!directAgent) {
    directAgent = new Agent({ connect: { timeout: 10_000 } });
  }
  return directAgent;
}

export const directFetch: typeof fetch = (input, init) =>
  undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: getDirectAgent(),
    } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>;

/** HTTP statuses worth retrying: the request itself was fine, the upstream was not. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 500 || status >= 502;
}

/**
 * Runs `attempt` up to `attempts` times. A thrown error (network failure,
 * timeout) is always retried; a returned value is retried only when
 * `shouldRetry` says so (e.g. a 502 response). The last outcome wins.
 */
export async function withRetry<T>(
  attempt: (attemptNo: number) => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    shouldRetry?: (value: T) => boolean;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attemptNo = 1; attemptNo <= attempts; attemptNo++) {
    const isLast = attemptNo === attempts;
    try {
      const value = await attempt(attemptNo);
      if (isLast || !options.shouldRetry?.(value)) return value;
    } catch (error) {
      lastError = error;
      if (isLast) throw error;
    }
    await sleep(baseDelayMs * Math.pow(3, attemptNo - 1));
  }
  // Unreachable: the loop always returns or throws on the last attempt.
  throw lastError;
}
