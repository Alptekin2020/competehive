function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

export function normalizeProductImage(input: unknown): string | null {
  try {
    if (typeof input === "string") {
      const trimmed = input.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (Array.isArray(input)) {
      return firstNonEmptyString(input);
    }

    if (input && typeof input === "object") {
      const obj = input as Record<string, unknown>;

      if (typeof obj.contentUrl === "string") {
        const trimmed = obj.contentUrl.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      if (Array.isArray(obj.contentUrl)) {
        return firstNonEmptyString(obj.contentUrl);
      }

      if (typeof obj.url === "string") {
        const trimmed = obj.url.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      if (typeof obj.src === "string") {
        const trimmed = obj.src.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}
