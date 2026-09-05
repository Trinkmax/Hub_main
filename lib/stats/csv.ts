// CSV writer mínimo: escapa quotes y wrapea cuando hay separador/quote/newline.
// Usable tanto en Node como en browser; sin deps externas.

export type CsvOptions = {
  /**
   * `,` es el default histórico (exports de stats). Para lo que abre el dueño
   * en Excel en es-AR conviene `;`: Excel en español usa la coma como decimal
   * y con `,` mete todo en una sola columna.
   */
  separator?: ',' | ';'
  /**
   * BOM UTF-8 al principio: sin él, Excel abre "García" como "GarcÃ­a".
   * Google Sheets y Numbers lo ignoran sin problema.
   */
  bom?: boolean
}

export function csvEscape(value: unknown, separator: ',' | ';' = ','): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'string' ? value : String(value)
  if (s.includes(separator) || /["\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function rowsToCsv(
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  opts: CsvOptions = {},
): string {
  const sep = opts.separator ?? ','
  const lines: string[] = []
  lines.push(headers.map((h) => csvEscape(h, sep)).join(sep))
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(v, sep)).join(sep))
  }
  // CRLF: es lo que Excel espera; el resto lo lee igual.
  const body = lines.join(opts.bom ? '\r\n' : '\n')
  return opts.bom ? `\uFEFF${body}` : body
}
