import { z } from "zod";

export const addProductSchema = z.object({
  productUrl: z.string().url("Gecerli bir URL giriniz"),
});

export const compareSchema = z.object({
  productId: z.string().uuid("Gecerli bir urun ID gerekli"),
});

export const scrapeTrigerSchema = z.object({
  productId: z.string().uuid("Gecerli bir urun ID gerekli"),
});

export const updateSettingsSchema = z.object({
  telegramChatId: z.string().optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
  emailNotifications: z.boolean().optional(),
  telegramNotifications: z.boolean().optional(),
  webhookNotifications: z.boolean().optional(),
});
