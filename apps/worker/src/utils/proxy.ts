// Builds the optional outbound proxy config from PROXY_* env. Returns null when
// no proxy is configured, so callers can cheaply skip all proxy wiring. Kept
// pure (env passed in) so it can be unit-tested.
export interface ProxyConfig {
  // `host:port` form for Chromium's `--proxy-server` launch flag.
  server: string;
  // `http://[user:pass@]host:port` form for undici's ProxyAgent.
  url: string;
  username?: string;
  password?: string;
}

export function getProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig | null {
  const host = env.PROXY_HOST?.trim();
  const portRaw = env.PROXY_PORT;
  if (!host || !portRaw) return null;

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) return null;

  const username = env.PROXY_USER?.trim() || undefined;
  const password = env.PROXY_PASS || undefined;
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password ?? "")}@`
    : "";

  return {
    server: `${host}:${port}`,
    url: `http://${auth}${host}:${port}`,
    username,
    password,
  };
}
