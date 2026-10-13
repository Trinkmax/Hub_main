/**
 * «¿Qué pagás?», la primera pregunta de «Pagar» (pedido de los socios,
 * 12/10/2026: «al pagar, elegir entre proveedor, gasto fijo u otro gasto»).
 * Puro: lo usa la hoja y lo prueba `administracion-compras.test.ts`.
 */

import type { AccountingAction, ActionParams } from '@/components/administracion/acciones/types'

/** Las tres respuestas, en el orden en que se ven. */
export const PAY_TARGETS = [
  {
    value: 'proveedor',
    label: 'A un proveedor',
    hint: 'Una factura que le debés o un pago a cuenta.',
  },
  {
    value: 'gasto-fijo',
    label: 'Un gasto fijo',
    hint: 'El alquiler, la luz, internet: lo elegís de tu lista y queda cargado este mes.',
  },
  {
    value: 'otro-gasto',
    label: 'Otro gasto',
    hint: 'Una compra o un gasto suelto que pagás en el momento.',
  },
] as const

export type PayTarget = (typeof PAY_TARGETS)[number]['value']

/**
 * ¿Se pregunta? No cuando ya se sabe qué se paga: la hoja se abrió desde un
 * proveedor (`?proveedor=`) o desde una factura (`?partida=`).
 */
export function payAsksTarget(params: ActionParams): boolean {
  return !params.proveedor && !params.partida
}

/**
 * La hoja que sigue a cada respuesta. «A un proveedor» se queda en «Pagar»;
 * los gastos fijos y los otros gastos se pagan con «Nuevo gasto», que arranca
 * por «¿En qué?» con los gastos fijos del mes primero.
 */
export function payTargetSheet(target: PayTarget): AccountingAction {
  return target === 'proveedor' ? 'pagar' : 'gasto'
}
