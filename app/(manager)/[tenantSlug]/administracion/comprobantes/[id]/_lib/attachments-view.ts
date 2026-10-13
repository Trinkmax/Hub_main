import type { DocumentKind } from '@/lib/accounting/types'

/**
 * Dónde se muestra «Comprobante adjunto» en la pantalla de un comprobante y
 * quién puede sumar o quitar archivos. Puro: lo usan la página y los tests. La
 * base vuelve a decidir el permiso (`acc_attach_document_file` y las políticas
 * del bucket).
 */

/** Los que arma el sistema solo: no hay un papel para fotografiar. */
const SYSTEM_MADE: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  'reversal',
  'fy_result',
  'fy_closing',
  'fy_opening',
])

export type AttachmentsBlock = {
  /** ¿Va el bloque en la pantalla? */
  show: boolean
  /** ¿Se ofrecen «Agregar foto o PDF» y «Quitar»? */
  canEdit: boolean
}

/**
 * - Suma y quita quien carga (`canWrite`), sobre un comprobante vigente que no
 *   sea de los que arma el sistema. La foto no toca el asiento, así que el mes
 *   cerrado no lo impide.
 * - Quien solo lee (la contadora) ve el bloque únicamente si hay archivos.
 * - `count === null`: la lista no se pudo leer; el bloque va con su aviso.
 */
export function attachmentsBlock(
  doc: { kind: DocumentKind; status: 'posted' | 'voided' },
  canWrite: boolean,
  count: number | null,
): AttachmentsBlock {
  const systemMade = SYSTEM_MADE.has(doc.kind)
  const canEdit = canWrite && doc.status === 'posted' && !systemMade
  const show = count === null ? !systemMade : canEdit || count > 0
  return { show, canEdit }
}
