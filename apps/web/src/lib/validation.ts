import { z } from "zod";

export const addProductSchema = z.object({
  productUrl: z.string().url("Geçerli bir URL girin"),
});

// Ürün maliyetini (COGS) güncelle. null = maliyeti temizle. Üst sınır, hatalı
// kuruş/lira girişini (ör. 12.500 yerine 1250000) erkenden eler.
export const updateProductSchema = z.object({
  cost: z
    .number()
    .min(0, "Maliyet 0 veya daha büyük olmalı")
    .max(99999999, "Maliyet çok yüksek")
    .nullable(),
});

export const compareSchema = z.object({
  productId: z.string().uuid("Geçerli bir ürün ID gerekli"),
});

export const scrapeTrigerSchema = z.object({
  productId: z.string().uuid("Geçerli bir ürün ID gerekli"),
});

export const updateSettingsSchema = z.object({
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  emailNotifications: z.boolean().optional(),
  telegramNotifications: z.boolean().optional(),
  webhookNotifications: z.boolean().optional(),
});
