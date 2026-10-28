/**
 * A CSV download Excel reads as UTF-8. Without the byte-order mark it falls back to the system code page,
 * which turns Chinese, Cyrillic and stylised names into gibberish.
 */
export function csvBlob(text: string) {
  return new Blob([String.fromCharCode(0xfeff), text], { type: "text/csv;charset=utf-8" });
}

// Quote delimiters and neutralize spreadsheet formulas without changing stored names.
export function csvCell(value: string | number) {
  if (typeof value === "number") return String(value);
  const text = /^[\s\u0000-\u001f\u007f]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}
