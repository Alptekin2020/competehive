"use client";

import { useState, useEffect, useCallback } from "react";

interface CompetitorItem {
  id?: string;
  marketplace: string;
  competitor_name: string | null;
  current_price: string | null;
  competitor_url: string;
  link?: string;
  retailerDomain?: string;
  retailerName?: string;
  retailerColor?: string;
}

interface ProductItem {
  id: string;
  product_name: string;
  marketplace: string;
  product_url: string;
  product_image: string | null;
  current_price: string | null;
  last_scraped_at: string | null;
  competitors?: CompetitorItem[];
}

interface CompareResult {
  marketplace: string;
  name: string;
  price: number;
  url: string;
  link: string;
  retailerDomain: string;
  retailerName: string;
  retailerColor: string;
}

function mapCompareResult(c: CompareResult): CompetitorItem {
  return {
    marketplace: c.marketplace,
    competitor_name: c.name,
    current_price: String(c.price),
    competitor_url: c.url,
    link: c.link,
    retailerDomain: c.retailerDomain,
    retailerName: c.retailerName,
    retailerColor: c.retailerColor,
  };
}

export function useProducts() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");

  const fetchProducts = useCallback(() => {
    return fetch("/api/products")
      .then((res) => res.json())
      .then((data) => {
        if (data.products) setProducts(data.products);
      })
      .catch((err) => console.error("Fetch products error:", err));
  }, []);

  useEffect(() => {
    fetchProducts().finally(() => setPageLoading(false));
  }, [fetchProducts]);

  const addProduct = async (url: string): Promise<string | null> => {
    setAddError("");
    setAddLoading(true);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await fetchProducts();

      // Background compare search
      fetch("/api/products/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id }),
      })
        .then((res) => res.json())
        .then((compareData) => {
          if (compareData.competitors?.length > 0) {
            setProducts((prev) =>
              prev.map((p) =>
                p.id === data.product.id
                  ? {
                      ...p,
                      competitors: compareData.competitors.map((c: CompareResult) =>
                        mapCompareResult(c),
                      ),
                    }
                  : p,
              ),
            );
          }
        })
        .catch((err) => console.error("Compare error:", err));

      return data.product.id;
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Bilinmeyen hata");
      return null;
    } finally {
      setAddLoading(false);
    }
  };

  const deleteProduct = async (productId: string) => {
    try {
      await fetch(`/api/products?id=${productId}`, { method: "DELETE" });
      setProducts((prev) => prev.filter((p) => p.id !== productId));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const updateCompetitors = (productId: string, competitors: CompetitorItem[]) => {
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, competitors } : p)));
  };

  return {
    products,
    pageLoading,
    addLoading,
    addError,
    setAddError,
    addProduct,
    deleteProduct,
    updateCompetitors,
  };
}
