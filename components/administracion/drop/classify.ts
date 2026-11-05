/**
 * Qué hacer con un archivo que alguien soltó en cualquier pantalla de Administración. Puro.
 *
 * - Una foto o un PDF es un comprobante: abre la compra.
 * - Una planilla o un ZIP es para importar: se abre y se reconoce de dónde viene (`detectSource`).
 */

export type DropKind = 'comprobante' | 'importar' | 'desconocido'

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif)$/i
const IMPORT_EXT = /\.(zip|csv|txt|tsv|xls|xlsx|html?)$/i

export function classifyDroppedFile(file: { name: string; type: string }): DropKind {
  if (file.type.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'comprobante'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'comprobante'
  if (IMPORT_EXT.test(file.name)) return 'importar'
  return 'desconocido'
}

/** La pantalla de importar que le toca a lo que se detectó. */
export function importPathFor(source: string): string {
  switch (source) {
    case 'arca_recibidos':
    case 'arca_emitidos':
    case 'portal_iva_compras':
      return '/importar/arca'
    case 'mp_release':
    case 'mp_settlement':
    case 'mp_collection':
      return '/importar/mercado-pago'
    case 'bank':
      return '/importar/banco'
    default:
      return '/importar'
  }
}
