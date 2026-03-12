import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface ProductAnalysis {
  brand: string;
  model: string;
  category: string;
  searchKeywords: string[];
  shortTitle: string;
}

export async function analyzeProduct(
  productName: string,
  marketplace: string,
  price: number | null,
): Promise<ProductAnalysis> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `Sen bir e-ticaret urun analiz asistanisin. Verilen urun basligindan marka, model ve arama anahtar kelimelerini cikar. Yanitini sadece JSON formatinda ver, baska hicbir sey yazma.`,
      },
      {
        role: "user",
        content: `Urun: "${productName}"
Marketplace: ${marketplace}
Fiyat: ${price ? price + " TL" : "bilinmiyor"}

Su JSON formatinda yanit ver:
{
  "brand": "Marka adi (orn: Samsung, Apple, Bosch)",
  "model": "Model adi/numarasi (orn: Galaxy S24, iPhone 15 Pro)",
  "category": "Kategori (orn: Televizyon, Telefon, Laptop, Musluk Bataryasi)",
  "searchKeywords": [
    "tam arama sorgusu: marka + model kodu + urun tipi (orn: 'Samsung Galaxy S24 Ultra Telefon')",
    "genel arama: marka + urun tipi + ana ozellik, model kodu OLMADAN (orn: 'Samsung 256GB Telefon')",
    "model kodu ile arama: sadece model/stok kodu varsa (orn: 'SM-S928B')",
    "alternatif: farkli kelime sirasi veya kisaltma (orn: 'Galaxy S24 Samsung')"
  ],
  "shortTitle": "Kisa ve temiz urun basligi (marka + model + ana ozellik, max 80 karakter)"
}

ONEMLI: searchKeywords icin 3-5 farkli arama varyasyonu uret. Amac: farkli marketplace'lerde (Trendyol, Hepsiburada, Amazon, N11) ayni urunu bulmak. Her marketplace farkli baslik kullanabilir, bu yuzden hem model kodlu hem model kodsuz arama kelimeleri olustur.`,
      },
    ],
    max_tokens: 300,
  });

  const text = response.choices[0]?.message?.content || "";

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      brand: "Bilinmiyor",
      model: productName.substring(0, 50),
      category: "Genel",
      searchKeywords: [productName.split(" ").slice(0, 4).join(" ")],
      shortTitle: productName.substring(0, 80),
    };
  }
}
