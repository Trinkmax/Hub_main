import { readFileSync } from 'node:fs'
import { inflateRawSync as zlibInflateRaw } from 'node:zlib'

/**
 * Lectura de los fixtures de importación para los tests (Vitest, Node). Los
 * archivos los escribe `scripts/imports/make-fixtures.mts` con `synth.ts`.
 */

export const IMPORT_FIXTURES = {
  mcG3Dic: 'mc-g3-recibidos-dic.zip',
  mcG3Nov: 'mc-g3-recibidos-nov.zip',
  mcG2Recibidos: 'mc-g2-recibidos.zip',
  mcG2Emitidos: 'mc-g2-emitidos.zip',
  mcXlsx: 'mc-g3-recibidos.xlsx',
  mcG1: 'mc-g1-recibidos.csv',
  mcCp1252: 'mc-g3-recibidos-cp1252.csv',
  mcExcelResaved: 'mc-g3-recibidos-pasado-por-excel.csv',
  pivaViejo: 'piva-compras-viejo.csv',
  pivaNuevo: 'piva-compras-nuevo.csv',
  mpRelease: 'mp-liquidaciones.csv',
  mpPanel: 'mp-liquidaciones-panel.csv',
  bankDc: 'banco-dc.csv',
  bankSigned: 'banco-signo.txt',
  bankBalance: 'banco-saldo.csv',
  bankXlsx: 'banco-columnas.xlsx',
  bankHtml: 'banco-html.xls',
} as const

export type ImportFixture = (typeof IMPORT_FIXTURES)[keyof typeof IMPORT_FIXTURES]

/** Bytes del fixture (como `Uint8Array`, igual que lo que da un `File` en el navegador). */
export function importFixture(name: ImportFixture): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./${name}`, import.meta.url)))
}

/** El descompresor de Node, para comparar contra el nuestro. */
export function nodeInflateRaw(data: Uint8Array): Uint8Array {
  return new Uint8Array(zlibInflateRaw(data))
}
