// Merkezi hata takibi (Sentry). DSN yoksa tüm fonksiyonlar no-op — geliştirme
// ortamı ek bağımlılık/gürültü olmadan çalışır. Prod'da SENTRY_DSN set edilirse
// worker'daki yakalanan-ama-kritik hatalar (scrape job fail, migration hatası,
// bildirim hatası) sahibinin haberi olmadan log çöplüğünde kaybolmaz.
import * as Sentry from "@sentry/node";

let enabled = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    // Worker'da istek izleme yok; yalnızca hata yakalama istiyoruz.
    tracesSampleRate: 0,
  });
  enabled = true;
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Kapanışta flush hatası kapanışı engellememeli.
  }
}
