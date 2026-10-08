/**
 * Fixtures SINTÉTICOS de los importadores (WP4, diseño §7).
 *
 *   npx tsx scripts/imports/make-fixtures.mts [carpeta]     (por defecto: tests/fixtures/imports)
 *
 * Se corre a mano y se commitean los archivos que deja. Los tests no lo corren:
 * leen los archivos. Todo sale de `tests/fixtures/imports/synth.ts` con semillas
 * fijas, así que volver a correrlo da los mismos textos (los bytes de los ZIP
 * pueden cambiar si cambia la versión de zlib; los tests comparan el contenido).
 *
 * Nada es real: CUIT inventadas con dígito verificador válido, razones sociales
 * de fantasía, importes pseudoaleatorios. Lo que sí imita es la FORMA de los
 * archivos reales de la investigación y los conteos de la tabla de
 * `arca-mis-comprobantes.md` §9.5:
 *
 *   Mis Comprobantes
 *   - mc-g3-recibidos-dic.zip   G3, 513 filas, 77 NC, 8 en USD, redondeo máx. $ 0,35
 *   - mc-g3-recibidos-nov.zip   G3, 539 filas, 75 NC, 12 en USD, redondeo máx. $ 0,55 (3 a nombre de un DNI)
 *   - mc-g2-recibidos.zip       G2, 1094 filas, 39 NC, 12 en DOL, 112 con percepciones sin detallar, máx. $ 0,04
 *   - mc-g2-emitidos.zip        G2 Emitidos, 3543 filas, 25 NC, todo en pesos, máx. $ 0,01
 *   - mc-g3-recibidos.xlsx      Excel: título combinado en la fila 1, títulos cortos en la 2, 3 filas (1 NC)
 *   - mc-g1-recibidos.csv       G1: `,`, todo entre comillas, punto decimal, CRLF
 *   - mc-g3-recibidos-cp1252.csv        G3 en Windows-1252, con la variante «del Emisor»
 *   - mc-g3-recibidos-pasado-por-excel.csv  fechas d/m/aaaa y CAE en notación científica
 *   - piva-compras-viejo.csv / piva-compras-nuevo.csv   Portal IVA (8 y 4 filas, máx. $ 0,05)
 *   Mercado Pago (Liquidaciones)
 *   - mp-liquidaciones.csv       `,`, 43 columnas, `TAXES_DISAGGREGATED` sin comillas, GMT-3
 *   - mp-liquidaciones-panel.csv `;`, JSON con comillas sin encerrar, GMT-4, `withdrawal`
 *   Banco
 *   - banco-dc.csv          NE24: metadatos, `;`, Windows-1252, CRLF, columna D/C y saldo
 *   - banco-signo.txt       `|`, importe con signo, sin saldo, un pendiente y dos filas idénticas
 *   - banco-saldo.csv       `,` y punto decimal, sin signo, del más nuevo al más viejo (sentido por saldo)
 *   - banco-columnas.xlsx   Débito/Crédito, fechas como celdas de fecha
 *   - banco-html.xls        el «.xls» que es una página HTML
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { parseMisComprobantes } from '@/lib/imports/arca/mis-comprobantes'
import { parseCsv, sniffDelimiter } from '@/lib/imports/csv'
import {
  bankBalanceCsv,
  bankDcCsv,
  bankHtml,
  bankSignedTxt,
  bankXlsxRows,
  CONSULTOR_CUIT,
  encodeCp1252,
  G3_RECIBIDOS_TITLES_DEL_EMISOR,
  g1RecibidosCsv,
  g2Csv,
  g3RecibidosCsv,
  MC_DIC_SPEC,
  MC_G2_EMITIDOS_SPEC,
  MC_G2_RECIBIDOS_SPEC,
  MC_NOV_SPEC,
  MC_SMALL_SPEC,
  makeEmitidos,
  makeRecibidos,
  mcExcelRows,
  mpPanelCsv,
  mpReleaseCsv,
  portalIvaCsv,
  SAS_CUIT,
  utf8,
  xlsxParts,
} from '@/tests/fixtures/imports/synth'
import { buildZip } from '@/tests/fixtures/imports/zip-writer'

const out = resolve(process.argv[2] ?? 'tests/fixtures/imports')
mkdirSync(out, { recursive: true })

const deflateRaw = (data: Uint8Array) => new Uint8Array(deflateRawSync(data, { level: 9 }))

const write = (name: string, bytes: Uint8Array) => {
  writeFileSync(join(out, name), bytes)
  console.log(`${name.padEnd(42)} ${String(bytes.length).padStart(7)} bytes`)
}

/** El ZIP como lo arma ARCA: un CSV, en streaming (bit 3) y con nombre UTF-8 (bit 11). */
const arcaZip = (inner: string, csv: string) =>
  buildZip([{ name: inner, data: utf8(csv) }], {
    deflateRaw,
    dataDescriptor: true,
    utf8Names: true,
  })

const innerName = (kind: 'recibidos' | 'emitidos', id: number, stamp: string) =>
  `comprobantes_consulta_csv_${kind}_${id}_${CONSULTOR_CUIT}_${stamp} (montos expresados en pesos).csv`

const xlsx = (parts: Record<string, string>) =>
  buildZip(
    Object.entries(parts).map(([name, text]) => ({ name, data: utf8(text) })),
    { deflateRaw },
  )

// ─── Mis Comprobantes ────────────────────────────────────────────────────────

const dic = makeRecibidos(MC_DIC_SPEC)
write(
  'mc-g3-recibidos-dic.zip',
  arcaZip(innerName('recibidos', 124446425, '20260102-1056'), g3RecibidosCsv(dic)),
)

const nov = makeRecibidos(MC_NOV_SPEC)
write(
  'mc-g3-recibidos-nov.zip',
  arcaZip(innerName('recibidos', 123998001, '20251211-0930'), g3RecibidosCsv(nov)),
)

const g2rec = makeRecibidos(MC_G2_RECIBIDOS_SPEC)
write(
  'mc-g2-recibidos.zip',
  arcaZip(innerName('recibidos', 124446425, '20250825-1056'), g2Csv(g2rec, 'recibidos')),
)

const g2emi = makeEmitidos(MC_G2_EMITIDOS_SPEC)
write(
  'mc-g2-emitidos.zip',
  arcaZip(innerName('emitidos', 124447584, '20250825-1059'), g2Csv(g2emi, 'emitidos')),
)

write(
  'mc-g3-recibidos.xlsx',
  xlsx(xlsxParts({ sheetName: 'Recibidos', rows: mcExcelRows(), merge: 'A1:AD1' })),
)

write('mc-g1-recibidos.csv', utf8(g1RecibidosCsv()))

const small = makeRecibidos(MC_SMALL_SPEC)
write(
  'mc-g3-recibidos-cp1252.csv',
  encodeCp1252(g3RecibidosCsv(small, { titles: G3_RECIBIDOS_TITLES_DEL_EMISOR })),
)
write(
  'mc-g3-recibidos-pasado-por-excel.csv',
  encodeCp1252(g3RecibidosCsv(small, { excel: true, eol: '\r\n' })),
)

write('piva-compras-viejo.csv', utf8(portalIvaCsv(2511, 8, 5)))
write('piva-compras-nuevo.csv', utf8(portalIvaCsv(2512, 4, 5)))

// ─── Mercado Pago ────────────────────────────────────────────────────────────

write('mp-liquidaciones.csv', utf8(mpReleaseCsv()))
write('mp-liquidaciones-panel.csv', utf8(mpPanelCsv()))

// ─── Banco ───────────────────────────────────────────────────────────────────

write('banco-dc.csv', encodeCp1252(bankDcCsv()))
write('banco-signo.txt', utf8(bankSignedTxt()))
write('banco-saldo.csv', utf8(bankBalanceCsv()))
write('banco-columnas.xlsx', xlsx(xlsxParts({ sheetName: 'Movimientos', rows: bankXlsxRows() })))
write('banco-html.xls', utf8(bankHtml()))

// ─── Resumen: los conteos de §9.5 con el parser de la app ────────────────────

const summary = (label: string, csv: string) => {
  const r = parseMisComprobantes(parseCsv(csv, sniffDelimiter(csv)), { sasCuit: SAS_CUIT })
  const s = r.stats
  console.log(
    `${label.padEnd(16)} ${r.layout} ${r.kind} · filas ${s.rows} · claves dup. ${s.duplicateKeys} · NC ${s.creditNotes}` +
      ` · ≠ARS ${s.foreignCurrency} · |Δ| > $1: ${s.totalGapRows} · mayor redondeo $${(s.maxRoundingCents / 100).toFixed(2)}`,
  )
}
console.log('')
summary('G3 dic', g3RecibidosCsv(dic))
summary('G3 nov', g3RecibidosCsv(nov))
summary('G2 recibidos', g2Csv(g2rec, 'recibidos'))
summary('G2 emitidos', g2Csv(g2emi, 'emitidos'))
