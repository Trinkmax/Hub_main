/**
 * Las cuotas de un pago con tarjeta de crédito — PURO.
 *
 * Pedido de los socios del 16/11/2026: al pagar con tarjeta, decir en cuántas cuotas. Es un dato del
 * pago (se guarda aparte, `acc_card_installments`): la deuda con la tarjeta entra entera el día de la
 * compra, como siempre, y las cuotas dicen cómo se va a ir pagando.
 */

/** Las que se ofrecen de un toque. Cualquier otra se escribe. */
export const INSTALLMENT_CHOICES = [1, 3, 6, 9, 12] as const
/** El tope que acepta la base. */
export const MAX_INSTALLMENTS = 48

/** Lo que se eligió, llevado a un número que la base acepta (1 = un solo pago). */
export function cleanInstallments(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return 1
  return Math.min(MAX_INSTALLMENTS, Math.max(1, Math.trunc(n)))
}

/** «1 pago», «3 cuotas». */
export function installmentsLabel(installments: number): string {
  return installments <= 1 ? '1 pago' : `${installments} cuotas`
}

/** «en 3 cuotas»; vacío si fue un solo pago (no hay nada que decir). */
export function installmentsWords(installments: number | null | undefined): string {
  return installments && installments > 1 ? `en ${installments} cuotas` : ''
}

/** ¿Esa caja es una tarjeta de crédito? Solo ahí se pregunta por las cuotas. */
export function isCreditCard(treasury: { kind: string } | null | undefined): boolean {
  return treasury?.kind === 'credit_card'
}

/** Lo que vale cada cuota, para mostrarlo al elegir (la última absorbe el redondeo). */
export function installmentAmountCents(
  totalCents: number | null,
  installments: number,
): number | null {
  if (totalCents === null || totalCents <= 0 || installments <= 1) return null
  return Math.round(totalCents / installments)
}
