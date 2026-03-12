import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  // In Next.js server-side, pino-pretty is not available; use default JSON
  // For local debugging, set LOG_LEVEL=debug
});
