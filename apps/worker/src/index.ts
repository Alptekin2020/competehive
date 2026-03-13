import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { runMigrations } from "./migrate";
import { processCompetitorJob } from "./jobs/competitor-processor";
import { processRefreshJob } from "./jobs/refresh-product";

export let productQueue: Queue;

async function start() {
  // 1. DB migration'ları çalıştır
  console.log("🗄️  Migration başlıyor...");
  await runMigrations();

  // 2. Redis bağlantısı
  const redisUrl = process.env.REDIS_URL!;
  const connection = { url: redisUrl, maxRetriesPerRequest: null };

  console.log("✅ Redis bağlantısı yapılandırıldı");

  // 3. Queue tanımı (web app'in job eklemesi için)
  productQueue = new Queue("product-jobs", { connection });

  // 4. Worker
  const worker = new Worker(
    "product-jobs",
    async (job) => {
      console.log(`📥 Job alındı: ${job.name} (${job.id})`);

      switch (job.name) {
        case "onboard":
          return processCompetitorJob(job);
        case "refresh":
          return processRefreshJob(job);
        default:
          console.warn(`⚠️ Bilinmeyen job: ${job.name}`);
          return undefined;
      }
    },
    {
      connection,
      concurrency: 3,
    },
  );

  worker.on("completed", (job) => {
    console.log(`✅ Job tamamlandı: ${job.name} (${job.id})`);
  });

  worker.on("failed", (job, err) => {
    console.error(`❌ Job başarısız: ${job?.name} (${job?.id}):`, err.message);
  });

  // 5. Periyodik refresh scheduler — her ürünü 6 saatte bir yenile
  setInterval(async () => {
    try {
      const { PrismaClient } = await import("@prisma/client");
      const prisma = new PrismaClient();
      const products = await prisma.trackedProduct.findMany({ select: { id: true } });

      for (const product of products) {
        await productQueue.add(
          "refresh",
          { productId: product.id },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 20 },
          },
        );
      }

      console.log(`🔄 ${products.length} ürün refresh kuyruğuna eklendi`);
      await prisma.$disconnect();
    } catch (err) {
      console.error("Refresh scheduler hatası:", err);
    }
  }, 6 * 60 * 60 * 1000); // 6 saat

  console.log("🚀 CompeteHive Worker başlatıldı");
}

start().catch((err) => {
  console.error("Worker başlatılamadı:", err);
  process.exit(1);
});
