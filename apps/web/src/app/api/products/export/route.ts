import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, serverError } from "@/lib/api-response";
import { buildCsv } from "@/lib/csv";
import { computeMargin } from "@competehive/shared";

function formatDate(value: Date | null) {
  if (!value) return "";
  return value.toISOString();
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const products = await prisma.trackedProduct.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        competitors: {
          select: {
            currentPrice: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const headers = [
      "product",
      "marketplace",
      "my_price",
      "cost",
      "profit",
      "margin_pct",
      "competitor_count",
      "last_update",
      "status",
      "tags",
      "product_url",
    ];

    const rows = products.map((product) => {
      // Maliyet girilmemişse kâr/marj kolonları boş kalır — "0" yazmak yanıltıcı olur.
      const margin = computeMargin(
        product.currentPrice ? Number(product.currentPrice) : null,
        product.cost ? Number(product.cost) : null,
      );
      return [
        product.productName,
        product.marketplace,
        product.currentPrice ? Number(product.currentPrice).toFixed(2) : "",
        product.cost ? Number(product.cost).toFixed(2) : "",
        margin ? margin.profit.toFixed(2) : "",
        margin ? margin.marginPct.toFixed(1) : "",
        product.competitors.length,
        formatDate(product.lastScrapedAt),
        product.status,
        product.tags.map((pt) => pt.tag.name).join(" | "),
        product.productUrl,
      ];
    });

    const csv = buildCsv(headers, rows);
    const filename = `competehive-products-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return serverError(error, "GET /api/products/export");
  }
}
