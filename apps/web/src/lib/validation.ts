import { z } from "zod";
import { checkGtinInput } from "@competehive/shared";

// Barkod isteğe bağlı: boş ya da eksik = yok. Girildiyse kontrol hanesi
// doğrulanır ve boşluksuz rakamlara çevrilir (worker `metadata.gtin` okur).
const optionalGtin = z
  .string()
  .max(32, "Barkod çok uzun")
  .nullable()
  .optional()
  .transform((raw, ctx) => {
    const check = checkGtinInput(raw);
    if (!check) return null;
    if (!check.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: check.error });
      return z.NEVER;
    }
    return check.gtin;
  });

export const addProductSchema = z.object({
  productUrl: z.string().url("Geçerli bir URL girin"),
  gtin: optionalGtin,
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

// Takipteki ürünün barkodu. null ya da boş = barkodu kaldır.
export const updateBarcodeSchema = z.object({
  gtin: optionalGtin,
});

/**
 * Ayarlar → "Mağaza adım": pazaryerlerinde satıcı olarak görünen kendi mağaza
 * adları. Aynı ilanda kendi fiyatı bu satırdan okunur, rakip sayılmaz.
 */
export const MAX_OWN_STORE_NAMES = 5;

/** Pazaryeri başına tek mağaza adı; boş metin o pazaryerinin adını siler. */
const ownStoreNameValue = z
  .string()
  .trim()
  .max(80, "Mağaza adı en fazla 80 karakter olabilir")
  .refine((value) => value.length === 0 || value.length >= 2, {
    message: "Mağaza adı en az 2 karakter olmalı",
  });

export const updateOwnStoresSchema = z
  .object({
    stores: z
      .record(z.string(), ownStoreNameValue)
      .refine((stores) => Object.keys(stores).length <= 30, "Geçersiz pazaryeri listesi")
      .optional(),
    // Eski "tüm pazaryerleri" listesi (yalnız silmek/düzenlemek için).
    storeNames: z
      .array(
        z
          .string()
          .trim()
          .min(2, "Mağaza adı en az 2 karakter olmalı")
          .max(80, "Mağaza adı en fazla 80 karakter olabilir"),
      )
      .max(MAX_OWN_STORE_NAMES, `En fazla ${MAX_OWN_STORE_NAMES} mağaza adı ekleyebilirsiniz`)
      .optional(),
  })
  .refine((body) => body.stores !== undefined || body.storeNames !== undefined, {
    message: "Güncellenecek alan yok",
  });

/** Boşlukları sadeleştirir, büyük/küçük harf farkıyla tekrarlananları atar. */
export function cleanOwnStoreNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    const key = name.toLocaleLowerCase("tr-TR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
