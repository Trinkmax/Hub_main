/**
 * Los motivos de lo que sale sin venderse — PURO.
 *
 * Pedido de los socios (16/11/2026): «bajar de stock lo mal comandado, lo de los socios, etc.». El
 * sistema no lleva stock por producto (sale de los conteos de la cocina), así que «bajar» es dejar
 * anotado qué salió sin venderse y por qué, para que los dueños vean cuánto fue.
 *
 * Dos cosas distintas, que el motivo separa:
 *   · una baja de algo que TODAVÍA NO SE HIZO no saca nada de la cocina ni de la barra;
 *   · una baja de algo que YA ESTABA HECHO, o una mesa que no se cobra, sí.
 * El «ya estaba hecho» viaja en el texto del motivo (`MADE_MARK`): la base guarda el motivo como
 * texto libre y así no hace falta tocarla.
 */

/** Lo que se le agrega al motivo de una baja cuando el producto ya estaba hecho. */
export const MADE_MARK = ' · ya estaba hecho'

/** Con este motivo, después se ofrece marcar el producto agotado. */
export const REASON_SOLD_OUT = 'No hay más'

/** Bajas de algo que todavía no se hizo: no se pierde nada. */
export const NOT_MADE_REASONS = [
  'Mal comandado',
  'El cliente cambió de idea',
  REASON_SOLD_OUT,
] as const

/** Bajas de algo que ya estaba hecho: se pierde el producto. */
export const MADE_REASONS = ['Mal comandado', 'Vino mal', 'Se demoró'] as const

/** Una mesa que no se cobra. */
export const COMP_REASONS = [
  'Consumo de socios',
  'Invitación de la casa',
  'Personal del bar',
] as const

/** Hasta dónde llega un motivo en la base. */
export const REASON_MAX = 200

/** El motivo como se guarda: con la marca si el producto ya estaba hecho. */
export function voidReasonText(label: string, made: boolean): string {
  const clean = label.trim().replace(MADE_MARK, '')
  if (!made) return clean.slice(0, REASON_MAX)
  return `${clean.slice(0, REASON_MAX - MADE_MARK.length)}${MADE_MARK}`
}

/** Motivos de antes, llevados al nombre que usan los socios. */
const OLD_NAMES: Readonly<Record<string, string>> = {
  'error de carga': 'Mal comandado',
  'cargado por error': 'Mal comandado',
}

/**
 * Un motivo guardado, leído: su nombre y si el producto ya estaba hecho. Vale la marca del texto o,
 * sin marca, que la cocina ya lo hubiera empezado (`started`).
 */
export function readVoidReason(
  text: string | null | undefined,
  started: boolean,
): { label: string; made: boolean } {
  const raw = (text ?? '').trim()
  const marked = raw.endsWith(MADE_MARK)
  const bare = (marked ? raw.slice(0, -MADE_MARK.length) : raw).trim()
  const label = OLD_NAMES[bare.toLowerCase()] ?? (bare === '' ? 'Sin motivo' : bare)
  return { label, made: marked || started }
}

/** «Consumo de socios · Nacho»: el motivo de una mesa que no se cobra, con para quién fue. */
export function compReasonText(reason: string, who: string): string {
  const base = reason.trim()
  const name = who.trim().replace(/\s+/g, ' ')
  return (name === '' ? base : `${base} · ${name}`).slice(0, REASON_MAX)
}

/** El motivo sin el «para quién», para agrupar («Consumo de socios · Nacho» → «Consumo de socios»). */
export function reasonGroup(reason: string): string {
  const text = reason.trim()
  const known = COMP_REASONS.find((item) => text === item || text.startsWith(`${item} · `))
  return known ?? (text === '' ? 'Sin motivo' : text)
}
