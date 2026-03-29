import http from "http";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { logger } from "./utils/logger";

const prisma = new PrismaClient();

export function startHealthServer(port: number = 8080) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      try {
        // Check DB
        await prisma.$queryRaw`SELECT 1`;

        // Check Redis
        const redis = new IORedis(process.env.REDIS_URL || "", {
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          lazyConnect: true,
        });
        await redis.connect();
        await redis.ping();
        await redis.quit();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unhealthy", error: message }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info(`Health check server listening on port ${port}`);
  });

  return server;
}
