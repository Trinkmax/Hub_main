/**
 * Los dos cuadros de «Por evento» (comentario C4 de los socios, 02/10/2026):
 * «Estos cuadritos son la clave, y deberían ser exportables ambos […] con el
 * cuadro de la izquierda rentabilidad. Con el cuadro de la derecha,
 * conversión.»
 *
 * - **Rentabilidad** (izquierda): la cuenta de cada fecha que ya pasó
 *   (`event-consolidated.ts`).
 * - **Conversión** (derecha): la gente que trajo cada fecha y lo que costó
 *   traerla (`event-conversion.ts`).
 *
 * Cada uno baja SU planilla, que es exactamente lo que el cuadro muestra
 * (pantalla = CSV). La planilla mezclada de antes no existe más: un pedido sin
 * `cuadro` (un link viejo) rebota con 400 en vez de adivinar.
 *
 * Puro: sin DB ni React.
 */

export type EventCuadro = 'rentabilidad' | 'conversion'

export const EVENT_CUADROS: Readonly<Record<EventCuadro, { title: string; subtitle: string }>> = {
  rentabilidad: {
    title: 'Rentabilidad',
    subtitle: 'Cuánto dejó cada fecha: el ingreso, menos el costo y la pauta.',
  },
  conversion: {
    title: 'Conversión',
    subtitle: 'Cuánta gente trajo cada fecha y cuánto costó traerla.',
  },
}

export const EXPORT_LABEL = 'Exportar'

/** `?cuadro=` de la ruta de exportar. Cualquier otra cosa es `null` (400). */
export function parseCuadro(value: string | null | undefined): EventCuadro | null {
  return value === 'rentabilidad' || value === 'conversion' ? value : null
}

/**
 * El «Exportar» de un cuadro. El nombre accesible CONTIENE el texto visible
 * (WCAG 2.5.3) y distingue los dos botones, que a la vista son iguales:
 * `Exportar Rentabilidad de 2x1 Burger Martes`.
 */
export function cuadroExport(
  cuadro: EventCuadro,
  input: { tenantSlug: string; templateId: string; templateName: string },
): { href: string; label: string; ariaLabel: string; title: string } {
  const { title } = EVENT_CUADROS[cuadro]
  const name = input.templateName.replace(/\s+/g, ' ').trim()
  return {
    href: `/api/como-nos-fue/export?slug=${encodeURIComponent(input.tenantSlug)}&vista=evento&evento=${encodeURIComponent(input.templateId)}&cuadro=${cuadro}`,
    label: EXPORT_LABEL,
    ariaLabel: `${EXPORT_LABEL} ${title} de ${name}`,
    title: `Bajar la planilla de ${title} (Excel o Sheets)`,
  }
}
