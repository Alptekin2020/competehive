// Next.js calls register() once when a server instance boots. We use it to
// fail fast on invalid/missing environment configuration instead of crashing
// late on the first request (validation schema lives in @competehive/shared),
// and to wire server-side error tracking (Sentry) when SENTRY_DSN is set.
export async function register() {
  // Only the Node.js server runtime exposes the full process.env we validate;
  // skip the edge runtime and the build phase (env may be partial there).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateWebEnv } = await import("@competehive/shared");
  validateWebEnv();

  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      // Yalnızca hata yakalama — istek izleme (tracing) kapalı.
      tracesSampleRate: 0,
    });
  }
}

// App Router sunucu isteklerindeki yakalanmamış hatalar (API rotaları, RSC)
// Sentry'ye raporlanır. DSN yoksa no-op.
export async function onRequestError(...args: unknown[]) {
  if (!process.env.SENTRY_DSN || process.env.NEXT_RUNTIME !== "nodejs") return;
  const Sentry = await import("@sentry/nextjs");
  return (Sentry.captureRequestError as (...a: unknown[]) => void)(...args);
}
