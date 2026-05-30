// Next.js calls register() once when a server instance boots. We use it to
// fail fast on invalid/missing environment configuration instead of crashing
// late on the first request (validation schema lives in @competehive/shared).
export async function register() {
  // Only the Node.js server runtime exposes the full process.env we validate;
  // skip the edge runtime and the build phase (env may be partial there).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateWebEnv } = await import("@competehive/shared");
  validateWebEnv();
}
