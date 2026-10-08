/**
 * La letra de una factura, nota de crédito o nota de débito de venta de la SAS
 * (responsable inscripta) según la condición frente al IVA del cliente.
 *
 * - **A** a un responsable inscripto y a un monotributista: desde la RG 5003/2021
 *   el monotributista recibe Factura A (con la leyenda de la Ley 27.618). Con la
 *   condición de ARCA (RG 5616) eso es 1, 6, 13 y 16: la elige `arcaLetterFor`
 *   (`lib/arca/emit-form.ts`), porque el partícipe guarda solo «monotributo».
 * - **B** al resto: consumidor final, exento, no alcanzado y sin datos.
 * - Si la SAS todavía no tiene la Factura A habilitada (`classA: false`), todo va
 *   con B: es lo único que se puede sugerir.
 *
 * Es solo la sugerencia del formulario «Ya la emití en otro sistema»: la persona
 * la cambia en el selector si su factura dice otra cosa.
 *
 * Puro: lo usan el formulario de venta (navegador) y los tests.
 */

import type { IvaCondition } from './types'

export type SalesLetter = 'a' | 'b'

/** Condiciones del cliente a las que un responsable inscripto le factura A (RG 5003/2021). */
export const LETTER_A_CONDITIONS: ReadonlySet<IvaCondition> = new Set<IvaCondition>([
  'responsable_inscripto',
  'monotributo',
])

/**
 * `'a'` o `'b'` para el cliente. `classA` (por defecto, `true`): la SAS puede
 * emitir Factura A.
 */
export function letterFor(
  condition: IvaCondition | null | undefined,
  opts: { readonly classA?: boolean } = {},
): SalesLetter {
  if (opts.classA === false) return 'b'
  return condition != null && LETTER_A_CONDITIONS.has(condition) ? 'a' : 'b'
}
