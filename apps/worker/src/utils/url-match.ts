/**
 * Host + pathname based URL key so tracking params, casing and www-prefix
 * differences don't break URL matching across Serper / scraper / DB sources.
 */
export function urlMatchKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return url.replace(/\/$/, "").toLowerCase();
  }
}
