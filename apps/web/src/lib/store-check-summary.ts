import prisma from "@/lib/prisma";

// Yönetici "Site Talepleri" görünümü: herkese açık uyumluluk kontrolü
// kayıtlarının (store_checks) alan adı bazında özeti.

const MAX_DOMAINS = 200;

export interface StoreCheckDomainRow {
  domain: string;
  checks: number;
  lastCheckedAt: string;
  /** Destek seviyesi ve gerekçeler: alan adının EN SON kontrolüne göre. */
  latestSupport: string;
  latestIssues: string[];
  latestUrl: string;
  /** "Desteklendiğinde haber ver" diyen farklı e-postalar. */
  emails: string[];
}

export interface StoreCheckSummary {
  days: number;
  totals: {
    checks: number;
    domains: number;
    waitlistEmails: number;
    bySupport: Record<string, number>;
  };
  /** En çok kontrol edilen alan adları önce (en fazla MAX_DOMAINS). */
  domains: StoreCheckDomainRow[];
}

/** Clamp a `days` query value to 1..365 (default 30). */
export function parseSummaryDays(raw: string | null): number {
  const value = Number(raw ?? 30);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 365) : 30;
}

function asIssues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function summarizeStoreChecks(days: number): Promise<StoreCheckSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = { createdAt: { gte: since } };

  const [total, bySupport, grouped, latestPerDomain, emailRows] = await Promise.all([
    prisma.storeCheck.count({ where }),
    prisma.storeCheck.groupBy({ by: ["support"], where, _count: { _all: true } }),
    prisma.storeCheck.groupBy({
      by: ["domain"],
      where,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { domain: "desc" } },
      take: MAX_DOMAINS,
    }),
    prisma.storeCheck.findMany({
      where,
      orderBy: { createdAt: "desc" },
      distinct: ["domain"],
      select: { domain: true, support: true, issues: true, url: true },
    }),
    prisma.storeCheck.findMany({
      where: { ...where, email: { not: null } },
      distinct: ["domain", "email"],
      select: { domain: true, email: true },
    }),
  ]);

  const latestByDomain = new Map(latestPerDomain.map((row) => [row.domain, row]));
  const emailsByDomain = new Map<string, string[]>();
  for (const row of emailRows) {
    if (!row.email) continue;
    const list = emailsByDomain.get(row.domain) ?? [];
    list.push(row.email);
    emailsByDomain.set(row.domain, list);
  }

  return {
    days,
    totals: {
      checks: total,
      domains: latestPerDomain.length,
      waitlistEmails: emailRows.length,
      bySupport: Object.fromEntries(bySupport.map((r) => [r.support, r._count._all])),
    },
    domains: grouped.map((row) => {
      const latest = latestByDomain.get(row.domain);
      return {
        domain: row.domain,
        checks: row._count._all,
        lastCheckedAt: (row._max.createdAt ?? since).toISOString(),
        latestSupport: latest?.support ?? "unknown",
        latestIssues: asIssues(latest?.issues),
        latestUrl: latest?.url ?? "",
        emails: emailsByDomain.get(row.domain) ?? [],
      };
    }),
  };
}
