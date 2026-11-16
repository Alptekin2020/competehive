import { beforeAll, describe, expect, it } from "vitest";
import { verifyProductMatch } from "../matcher";

beforeAll(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("fallbackMatch (no API key) — model identity", () => {
  it("does not return isMatch=true when the candidate cannot confirm the code", async () => {
    const result = await verifyProductMatch(
      { title: "Philips EP3347/90 3300 Serisi Espresso Makinesi LatteGo" },
      { title: "Philips 3300 Serisi Espresso Makinesi LatteGo Siyah" },
    );
    expect(result.aiUnavailable).toBe(true);
    expect(result.isMatch).toBe(false);
  });

  it("still guesses a likely match for code-less products", async () => {
    const result = await verifyProductMatch(
      { title: "Artema Maestro Lavabo Bataryası Krom" },
      { title: "Artema Maestro Banyo Lavabo Bataryası" },
    );
    expect(result.aiUnavailable).toBe(true);
    expect(result.isMatch).toBe(true);
  });
});
