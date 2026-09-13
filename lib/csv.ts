// Quote delimiters and neutralize spreadsheet formulas without changing stored names.
export function csvCell(value: string | number) {
  if (typeof value === "number") return String(value);
  const text = /^[\s\u0000-\u001f\u007f]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}
