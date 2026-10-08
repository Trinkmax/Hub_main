/**
 * Fechas de los archivos → días civiles `yyyy-MM-dd` y días contables de Córdoba
 * (`arca-mis-comprobantes.md` §9.4, `banco.md` §3.3, `mercadopago.md` §2.8).
 *
 * - `toIsoDay`: una fecha SIN hora (comprobantes, extractos). Acepta ISO,
 *   `d/m/aaaa`, `d/m/aa` (→ 20aa), `d-m-aaaa`, `d.m.aaaa`, `AAAAMMDD`, meses con
 *   nombre (`01-dic-2025`) y el número de serie de Excel (sistema 1900 con su
 *   29/02/1900 inexistente, o 1904). Nunca construye un `Date`: los días se
 *   cuentan con `lib/dates/civil`, igual en cualquier zona horaria.
 * - `instantToCordobaDay`: un instante CON zona (`2026-10-05T23:40:00.000-04:00`
 *   de Mercado Pago). Lee el offset del texto, pasa a Córdoba (UTC−3) y aplica
 *   el corte de día del bar (0 = día calendario, 5 = día de servicio).
 */

import {
  addDays,
  civilFromDays,
  daysFromCivil,
  toIsoDay as formatIsoDay,
  isRealIsoDay,
} from '@/lib/dates/civil'
import { cordobaDateTime, readDateValue } from '@/lib/dates/zone'
import type { IsoDate } from './types'

const MONTHS: Readonly<Record<string, number>> = {
  ene: 1,
  jan: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  aug: 8,
  sep: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
  dec: 12,
}

/** Días entre el 01/01/1970 y el día 0 de cada sistema de fechas de Excel. */
const EXCEL_1900_EPOCH = daysFromCivil(1899, 12, 30)
const EXCEL_1904_EPOCH = daysFromCivil(1904, 1, 1)

/** El serial de Excel más grande que existe: 31/12/9999. */
const EXCEL_MAX_SERIAL = 2_958_465

function real(year: number, month: number, day: number): IsoDate | null {
  const iso = formatIsoDay(year, month, day)
  return isRealIsoDay(iso) ? iso : null
}

/**
 * Serial de Excel → día. Sistema 1900: el 1 es el 01/01/1900 y el 60 es el
 * 29/02/1900, que no existió (Excel lo copió de Lotus 1-2-3): ese da `null`.
 * Sistema 1904 (Excel viejo de Mac): el 0 es el 01/01/1904. La hora se redondea
 * al segundo, como la muestra Excel: `45992.9999999999` ya es el día siguiente.
 */
export function excelSerialToIsoDay(serial: number, date1904 = false): IsoDate | null {
  if (!Number.isFinite(serial)) return null
  const days = Math.floor(Math.round(serial * 86400) / 86400)
  if (date1904) {
    if (days < 0 || days > EXCEL_MAX_SERIAL - 1462) return null
    const c = civilFromDays(EXCEL_1904_EPOCH + days)
    return real(c.year, c.month, c.day)
  }
  if (days < 1 || days > EXCEL_MAX_SERIAL || days === 60) return null
  // Antes del 01/03/1900 la cuenta corre un día por el 29/02 fantasma.
  const c = civilFromDays(EXCEL_1900_EPOCH + (days < 60 ? days + 1 : days))
  return real(c.year, c.month, c.day)
}

/** Segundos del día de un serial de Excel, redondeados como los muestra Excel. */
export function excelSerialSeconds(serial: number): number {
  const total = Math.round(serial * 86400)
  return ((total % 86400) + 86400) % 86400
}

/** Hora del día de un serial de Excel (`0.5` → `'12:00:00'`), redondeada al segundo. */
export function excelSerialTime(serial: number): string {
  const seconds = excelSerialSeconds(serial)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export type ToIsoDayOptions = {
  /** Orden de día y mes en las fechas con barras. En la Argentina, `dmy` (default). */
  order?: 'dmy' | 'mdy'
  /** Para seriales de Excel de un libro con el sistema 1904. */
  date1904?: boolean
}

/** El año de dos cifras va al siglo XXI: los archivos que importamos son de 2000 en adelante. */
function fullYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y)
}

/**
 * Una fecha de un archivo → `yyyy-MM-dd`, o `null` si no se entiende o el día no
 * existe. Los números se leen como serial de Excel. Ver el encabezado del archivo.
 */
export function toIsoDay(raw: unknown, opts: ToIsoDayOptions = {}): IsoDate | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return excelSerialToIsoDay(raw, opts.date1904 ?? false)
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[  ]/g, ' ').trim()
  if (s === '') return null

  // ISO, con hora o sin ella (la hora y la zona no cambian el día escrito).
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s)
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]))

  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]))

  // d/m/aaaa, d-m-aa, d.m.aaaa, con una hora opcional detrás.
  m =
    /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?)?$/i.exec(
      s,
    )
  if (m) {
    const a = Number(m[1])
    const b = Number(m[3])
    const year = fullYear(m[4] ?? '')
    return opts.order === 'mdy' ? real(year, a, b) : real(year, b, a)
  }

  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]))

  // 01-dic-2025, 1 dic 25, 01/Dec/2025.
  m = /^(\d{1,2})[\s/.-]+([a-z]{3})[a-z]*\.?[\s/.-]+(\d{4}|\d{2})$/i.exec(
    s.normalize('NFD').replace(/[̀-ͯ]/g, ''),
  )
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()]
    if (month === undefined) return null
    return real(fullYear(m[3] ?? ''), month, Number(m[1]))
  }
  return null
}

/** ¿Una fecha de texto está escrita con barras (`1/12/2025`)? Pista de «pasó por Excel». */
export function isSlashedDate(raw: unknown): boolean {
  return typeof raw === 'string' && /^\d{1,2}\/\d{1,2}\/(\d{4}|\d{2})/.test(raw.trim())
}

/**
 * Un instante con zona → día de Córdoba con corte (`cutoffHour` de 0 a 8: antes
 * de esa hora cuenta como el día anterior, como el día de servicio del tablero).
 * Sin zona se toma como hora de Córdoba; un día solo (`2026-10-05`) vuelve tal
 * cual. `null` si no se entiende.
 */
export function instantToCordobaDay(raw: unknown, cutoffHour = 0): IsoDate | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  const read = readDateValue(text)
  if (!read) return null
  if (read.kind === 'day') return read.date
  const parts = cordobaDateTime(text)
  if (!parts) return null
  const cutoff = Math.max(0, Math.min(23, Math.trunc(cutoffHour)))
  return parts.hour < cutoff ? addDays(parts.date, -1) : parts.date
}

/**
 * Un instante → ISO UTC (`2026-10-05T03:40:00.000Z`). Sin zona se toma como hora
 * de Córdoba (UTC−3). `null` si no se entiende o si es un día sin hora.
 */
export function toUtcInstant(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const read = readDateValue(raw.trim())
  if (!read || read.kind === 'day') return null
  if (read.kind === 'instant') return new Date(read.ms).toISOString()
  const [y, mo, d] = read.date.split('-').map(Number)
  const epochDays = daysFromCivil(y ?? 1970, mo ?? 1, d ?? 1)
  // Córdoba está en UTC−3 fijo desde 2009: la hora de reloj + 3 h es UTC.
  const ms =
    epochDays * 86_400_000 + (read.hour + 3) * 3_600_000 + read.minute * 60_000 + read.second * 1000
  return new Date(ms).toISOString()
}
