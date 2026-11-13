/**
 * La fecha de la cuenta — PURO.
 *
 * Igual que `clockAt`: se arma con las partes de `Intl` en la zona horaria del bar, así el servidor y
 * el celular escriben exactamente lo mismo.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit' })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

/** «13/11» en la zona horaria del bar. Vacío si la fecha no se puede leer. */
export function dayAt(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = formatterFor(timeZone).formatToParts(date)
  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  return day && month ? `${day}/${month}` : ''
}
