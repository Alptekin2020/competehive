import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: IORedis | null = null;

function getRedisConnection() {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
  }
  return connection;
}

export function getScrapeQueue() {
  return new Queue("scrape", { connection: getRedisConnection() });
}

export function getCompetitorQueue() {
  return new Queue("competitors", { connection: getRedisConnection() });
}

export async function addScrapeJob(productId: string, marketplace: string, productUrl: string) {
  const queue = getScrapeQueue();
  await queue.add(
    "scrape-product",
    { productId, marketplace, productUrl },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
}

export async function addCompetitorSearchJob(productId: string, productName: string, marketplace: string) {
  const queue = getCompetitorQueue();
  await queue.add(
    "find-competitors",
    { productId, productName, marketplace },
    {
      attempts: 2,
      backoff: { type: "exponential", delay: 3000 },
    },
  );
}
