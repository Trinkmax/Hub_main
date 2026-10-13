/**
 * «La clasificación vive en la ficha del proveedor» (pedido de los socios,
 * 12/10/2026), lo puro: cuándo se pregunta «¿En qué gastaste?» al cargar un
 * gasto o una compra y cuándo sale sola de la ficha. Lo usan «Nuevo gasto» y
 * la factura de proveedor. Lo prueba `administracion-cuenta-proveedor.test.ts`.
 */

/**
 * Cómo va la cuenta de un egreso:
 * - `fixed`: sale de la ficha del proveedor. No se pregunta: una línea «Va a
 *   «…»» con [Cambiar] para esta carga.
 * - `ask`: se pregunta, como siempre.
 * - `ask-remember`: se pregunta y se ofrece «Usar siempre para …» (el
 *   proveedor todavía no tiene cuenta habitual).
 */
export type AccountAsk = 'fixed' | 'ask' | 'ask-remember'

/** La cuenta habitual de la ficha, solo si se le puede imputar una compra (activa, imputable). */
export function supplierDefaultAccount(
  defaultAccountId: string | null | undefined,
  imputableAccountIds: ReadonlySet<string>,
): string | null {
  return defaultAccountId && imputableAccountIds.has(defaultAccountId) ? defaultAccountId : null
}

export function accountAsk(input: {
  /** Un proveedor ya cargado (no uno nuevo, ni «todavía sin elegir»). */
  existingParty: boolean
  /** La cuenta habitual de su ficha que sirve (`supplierDefaultAccount`). */
  defaultAccountId: string | null
  /** La cuenta que tiene la carga ahora. */
  accountId: string | null
  /** Se eligió un gasto fijo: trae su propia cuenta. */
  recurringLinked: boolean
  /** La persona tocó «Cambiar» en esta carga. */
  changing: boolean
}): AccountAsk {
  // Proveedor nuevo (la cuenta queda en su ficha al crearlo), sin proveedor o gasto fijo: como siempre.
  if (!input.existingParty || input.recurringLinked) return 'ask'
  if (input.defaultAccountId === null) return 'ask-remember'
  // Nunca se esconde una cuenta distinta de la que se nombra.
  if (input.changing || input.accountId !== input.defaultAccountId) return 'ask'
  return 'fixed'
}

/**
 * La cuenta que hay que guardar en la ficha después de cargar: solo si se
 * ofreció «Usar siempre para …», quedó tildado y se eligió una cuenta.
 */
export function accountToRemember(input: {
  ask: AccountAsk
  remember: boolean
  accountId: string | null
}): string | null {
  return input.ask === 'ask-remember' && input.remember ? input.accountId : null
}
