import http from "http";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import { logger } from "./utils/logger";

const prisma = new PrismaClient();

// Platform healthcheck'leri sık gelir — istek başına yeni bağlantı açmak
// yerine tek kalıcı Redis istemcisi kullanılır.
let healthRedis: IORedis | null = null;

function getHealthRedis(): IORedis {
  if (!healthRedis) {
    healthRedis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    healthRedis.on("error", (err) => {
      logger.warn({ err: err.message }, "Health Redis error");
    });
  }
  return healthRedis;
}

export function startHealthServer(port: number = 8080) {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      try {
        // Check DB
        await prisma.$queryRaw`SELECT 1`;

        // Check Redis
        await getHealthRedis().ping();

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
