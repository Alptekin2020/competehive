import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function verifyProductMatch(
  sourceTitle: string,
  candidateTitle: string,
): Promise<boolean> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Sen bir ürün eşleştirme asistanısın. Aşağıdaki iki ürünün aynı ürün olup olmadığını belirle. Marka, model ve temel özellikler eşleşmeli. Sadece "EVET" veya "HAYIR" ile yanıt ver.\n\nKaynak: "${sourceTitle}"\nAday: "${candidateTitle}"`,
        },
      ],
      max_tokens: 5,
      temperature: 0,
    });

    const answer = res.choices[0]?.message?.content?.trim().toUpperCase();
    return answer === "EVET";
  } catch (err) {
    console.error("GPT match hatası:", err);
    // API hatası durumunda title benzerliğine göre fallback
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const src = normalize(sourceTitle);
    const cnd = normalize(candidateTitle);
    return src.length > 5 && cnd.includes(src.slice(0, Math.floor(src.length * 0.6)));
  }
}
