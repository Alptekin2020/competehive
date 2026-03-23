import OpenAI from "openai";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      return null;
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function fallbackMatch(sourceTitle: string, candidateTitle: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const src = normalize(sourceTitle);
  const cnd = normalize(candidateTitle);
  return src.length > 5 && cnd.includes(src.slice(0, Math.floor(src.length * 0.6)));
}

export async function verifyProductMatch(
  sourceTitle: string,
  candidateTitle: string,
): Promise<boolean> {
  const client = getOpenAIClient();
  if (!client) {
    return fallbackMatch(sourceTitle, candidateTitle);
  }

  try {
    const res = await client.chat.completions.create({
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
    return fallbackMatch(sourceTitle, candidateTitle);
  }
}
