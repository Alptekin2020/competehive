export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const headerRow = headers.map(escapeCsvValue).join(",");
  const dataRows = rows.map((row) => row.map(escapeCsvValue).join(","));
  return [headerRow, ...dataRows].join("\n");
}
