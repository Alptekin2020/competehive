import { z } from "zod";

export const addProductSchema = z.object({
  productUrl: z.string().url("Geçerli bir URL girin"),
});

// Ürün maliyetini (COGS) güncelle. null = maliyeti temizle. Üst sınır, hatalı
// kuruş/lira girişini (ör. 12.500 yerine 1250000) erkenden eler.
export const updateProductSchema = z
  .object({
    cost: z
      .number()
      .min(0, "Maliyet 0 veya daha büyük olmalı")
      .max(99999999, "Maliyet çok yüksek")
      .nullable()
      .optional(),
    // Elle girilen kendi satış fiyatı: scraper (Trendyol IP engeli vb.) fiyatı
    // hiç alamadığında kullanıcı kendi fiyatını girerek pozisyon/öneri
    // hesaplarını çalıştırabilir.
    ownPrice: z
      .number()
      .positive("Fiyat 0'dan büyük olmalı")
      .max(99999999, "Fiyat çok yüksek")
      .optional(),
  })
  .refine((d) => d.cost !== undefined || d.ownPrice !== undefined, {
    message: "Güncellenecek alan yok",
  });

export const compareSchema = z.object({
  productId: z.string().uuid("Geçerli bir ürün ID gerekli"),
});

export const scrapeTrigerSchema = z.object({
  productId: z.string().uuid("Geçerli bir ürün ID gerekli"),
});

export const checkoutSchema = z.object({
  // FREE checkout'a giremez; bilinmeyen plan adları da burada elenir.
  planId: z.enum(["STARTER", "PRO", "ENTERPRISE"], {
    errorMap: () => ({ message: "Geçersiz plan" }),
  }),
  billing: z.enum(["monthly", "yearly"]).default("monthly"),
});

export const updateSettingsSchema = z.object({
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  emailNotifications: z.boolean().optional(),
  telegramNotifications: z.boolean().optional(),
  webhookNotifications: z.boolean().optional(),
});
