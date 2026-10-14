/**
 * El sello de cada papel, uno solo para toda Administración: qué dice el
 * `TicketStamp` de un comprobante según su tipo (`voucher_type`). Puro.
 *
 * Existe para que un papel lleve el MISMO sello antes de guardar y después,
 * en cualquier pantalla: el ticket de «Nuevo gasto» sella «Con factura A» y
 * la ficha de ese comprobante, la compra, el gasto del banco y la propuesta
 * de un importado tienen que decir exactamente eso. Para los cuatro papeles de
 * «Nuevo gasto» devuelve lo mismo que `paperStamp()` de `gasto-papel.ts` (lo
 * prueba `tests/lib/adm-voucher-stamp.test.ts`).
 *
 * La regla de los sellos: un sello dice QUÉ PAPEL ES. Los dos tonos son tintas
 * de sello, no estados: `factura` (verde) y `sin` (azul). «Sin factura» no es
 * una alarma: queda registrado igual en los libros, y lo único que cambia es
 * que no entra al Libro IVA.
 *
 * Cuándo NO:
 * - para un estado de pago o de vencimiento («Pagada», «A cobrar», «Vencida»):
 *   eso es `StatusPill`;
 * - para un acto terminado («CARGADO», «CERRADO»): eso es `TicketStamp
 *   tone="ok"` con su propio texto;
 * - para un comprobante anulado: es la banda de su ficha, no un sello;
 * - para el cierre del día: su sello lo arma `CloseTicket` con el reparto del
 *   día («Sin factura» · «82 % con factura» · «Todo con factura»);
 * - para nombrar el comprobante en una lista o en un título: eso es
 *   `voucherLabel()` / `voucherDisplay()` («Factura A 0003-00001290»).
 */

import {
  isVoucherType,
  VOUCHER_CATALOG,
  type VoucherFamily,
  type VoucherLetter,
} from '@/lib/accounting/voucher-types'
import type { PaperStamp } from './acciones/gasto-papel'

export type { PaperStamp }

/**
 * La letra que se sella. La «M» es hoy «Factura A sujeta a retención»
 * (RG 5762/2025): para quien la tiene en la mano es una A, y sella A.
 */
function stampLetter(letter: VoucherLetter | null): string {
  if (letter === null) return ''
  return letter === 'M' ? 'A' : letter
}

function withLetter(text: string, letter: VoucherLetter | null): PaperStamp {
  return { tone: 'factura', text: `${text} ${stampLetter(letter)}`.trim() }
}

/**
 * La tabla: una familia de comprobantes, un sello. Lo que no es «sin factura»
 * sella con la tinta de `factura` y dice con qué papel quedó.
 */
const FAMILY_STAMPS: Readonly<Record<VoucherFamily, (letter: VoucherLetter | null) => PaperStamp>> =
  {
    sin_comprobante: () => ({ tone: 'sin', text: 'Sin factura' }),
    factura: (letter) => withLetter('Con factura', letter),
    tique: () => ({ tone: 'factura', text: 'Con tique' }),
    tique_factura: (letter) => withLetter('Con tique factura', letter),
    recibo: (letter) => withLetter('Con recibo', letter),
    nota_credito: (letter) => withLetter('Con nota de crédito', letter),
    nota_debito: (letter) => withLetter('Con nota de débito', letter),
    liquidacion: () => ({ tone: 'factura', text: 'Con liquidación' }),
    resumen_bancario: () => ({ tone: 'factura', text: 'Con resumen del banco' }),
    otro: () => ({ tone: 'factura', text: 'Con otro comprobante' }),
    ddjj: () => ({ tone: 'factura', text: 'Con boleta de impuesto' }),
  }

/**
 * El sello de un comprobante por su tipo. `null` = sin sello: el comprobante
 * no tiene tipo (un pago, un cobro sin liquidación, un pase entre cajas) o es
 * un tipo que este catálogo no conoce. Sin tipo no se inventa un «Sin
 * factura»: ese sello dice algo que alguien eligió.
 */
export function voucherStamp(voucherType: string | null | undefined): PaperStamp | null {
  if (!isVoucherType(voucherType)) return null
  const info = VOUCHER_CATALOG[voucherType]
  return FAMILY_STAMPS[info.family](info.letter)
}
