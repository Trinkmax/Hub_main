import type * as React from 'react'
import { BADGE_DOT_CLASS, Badge, type BadgeTone } from '@/components/ui/badge'
import { DEFAULT_SOON_DAYS, type DueBucket, dueBucket } from '@/lib/accounting/aging'
import {
  daysBetween,
  formatDayMonth,
  formatIsoDay,
  isoDayInCordoba,
  isRealIsoDay,
  todayInCordoba,
} from '@/lib/dates'
import { cn } from '@/lib/utils'

/**
 * Semáforo de vencimientos (kit HUB §3.4): siempre punto + palabras, nunca
 * solo color. «Vencida hace 3 días», «Vence hoy», «Vence en 5 días», «Al día»,
 * «Pagada». El texto ya es la etiqueta accesible: el punto lleva `aria-hidden`.
 *
 * Server-safe (sin hooks). Las fechas son días del bar (`yyyy-MM-dd`, Córdoba)
 * y se cuentan con enteros (`lib/dates`): nunca `new Date('yyyy-MM-dd')`, que
 * en GMT−3 es el día anterior. Los cortes de cada tramo no viven acá: son los
 * de `dueBucket` (`lib/accounting/aging.ts`), los mismos que la antigüedad de
 * saldos y su espejo en SQL, así la pantalla y el reporte no se contradicen.
 */

export type { DueBucket }

export type DueStatusInput = {
  /** `yyyy-MM-dd` (columna `date`). Un `timestamptz` se lee como su día en Córdoba. */
  dueDate: string | null | undefined
  /** `yyyy-MM-dd`. Default `todayInCordoba()`. */
  today?: string
  /** Pagada o cobrada: gana sobre la fecha. */
  settled?: boolean
  /** Hasta cuántos días antes cuenta como «vence pronto». Default 7 (`DEFAULT_SOON_DAYS`, el `due_soon_days` del bar). */
  soonDays?: number
}

export type DueStatusInfo = {
  bucket: DueBucket
  /** Días hasta el vencimiento (`soon`, `current`) o desde (`overdue`); 0 hoy; `null` sin fecha o pagada. */
  days: number | null
  /** El vencimiento como `yyyy-MM-dd`, o `null`. */
  dueDay: string | null
  /** El día contra el que se contó. */
  today: string
  /** Tono del punto; `null` = sin punto («Sin vencimiento»). */
  tone: BadgeTone | null
}

const BUCKET_TONE: Readonly<Record<DueBucket, BadgeTone | null>> = {
  settled: 'neutral',
  'no-due': null,
  current: 'success',
  soon: 'warning',
  today: 'warning',
  overdue: 'danger',
}

/** El día del vencimiento: un `date` tal cual; un instante, su día en Córdoba. */
function toDueDay(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.trim()
  if (isRealIsoDay(text)) return text
  return isoDayInCordoba(text)
}

/**
 * En qué tramo cae un vencimiento y a cuántos días (lógica pura: la usa
 * `DueStatus` y sirve para filtrar u ordenar). El tramo lo decide `dueBucket`;
 * acá solo se normaliza la entrada y se cuentan los días para el texto.
 */
export function getDueStatus({
  dueDate,
  today,
  settled = false,
  soonDays = DEFAULT_SOON_DAYS,
}: DueStatusInput): DueStatusInfo {
  // Un `today` mal formado no tiene que tirar la pantalla: se cuenta desde hoy.
  const base = today && isRealIsoDay(today) ? today : todayInCordoba()
  // Sin fecha o ilegible: no se inventa un vencimiento (queda «Sin vencimiento»).
  const dueDay = toDueDay(dueDate)
  const bucket = dueBucket(dueDay, base, soonDays, settled)
  const diff = bucket === 'settled' || dueDay === null ? null : daysBetween(base, dueDay)
  return {
    bucket,
    days: diff === null ? null : Math.abs(diff),
    dueDay,
    today: base,
    tone: BUCKET_TONE[bucket],
  }
}

/** `22/10` en el año en curso; `22/10/2027` si es otro año. */
function formatDue(dueDay: string, today: string): string {
  return dueDay.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(dueDay) : formatIsoDay(dueDay)
}

/**
 * El texto del semáforo. Con `showDate`, «Al día» pasa a «Vence el 22/10» y
 * «vence pronto» y «vencida» suman «· 22/10»; «Vence hoy» no lo necesita.
 */
export function formatDueStatus(
  info: DueStatusInfo,
  { showDate = false, settledLabel = 'Pagada' }: { showDate?: boolean; settledLabel?: string } = {},
): string {
  const { bucket, days, dueDay, today } = info
  const date = dueDay ? formatDue(dueDay, today) : ''
  const withDate = (text: string) => (showDate && date ? `${text} · ${date}` : text)
  const n = days ?? 0

  switch (bucket) {
    case 'settled':
      return settledLabel
    case 'no-due':
      return 'Sin vencimiento'
    case 'current':
      return showDate && date ? `Vence el ${date}` : 'Al día'
    case 'soon':
      // Mismo texto que `dueLabel` de lib/accounting/aging (singular incluido).
      return withDate(n === 1 ? 'Vence en 1 día' : `Vence en ${n} días`)
    case 'today':
      return 'Vence hoy'
    case 'overdue':
      return withDate(n === 1 ? 'Vencida hace 1 día' : `Vencida hace ${n} días`)
  }
}

/** Los tramos cuyo texto suma la fecha con `showDate`. */
const DATED_BUCKETS: ReadonlySet<DueBucket> = new Set(['current', 'soon', 'overdue'])

const BUCKET_TEXT_CLASS: Readonly<Record<DueBucket, string>> = {
  settled: 'text-muted-foreground',
  'no-due': 'text-muted-foreground',
  current: '',
  soon: '',
  today: 'font-medium',
  overdue: 'text-destructive-text',
}

export type DueStatusProps = Omit<React.ComponentProps<'span'>, 'children'> &
  DueStatusInput & {
    /** `inline` (punto + texto, default) o `badge` (etiqueta suave del tono). */
    variant?: 'inline' | 'badge'
    /** Suma la fecha corta: «Vencida hace 3 días · 03/10». */
    showDate?: boolean
    /** Default «Pagada»; «Cobrada» en lo que nos deben. */
    settledLabel?: string
  }

function DueStatus({
  dueDate,
  today,
  settled,
  soonDays,
  variant = 'inline',
  showDate = false,
  settledLabel,
  className,
  ...props
}: DueStatusProps) {
  const info = getDueStatus({ dueDate, today, settled, soonDays })
  const label = formatDueStatus(info, { showDate, settledLabel })
  // Si el texto no dice la fecha, queda a mano al pasar el mouse.
  const dateInLabel = showDate && DATED_BUCKETS.has(info.bucket)
  const dateHint =
    info.dueDay && info.bucket !== 'settled' && !dateInLabel
      ? `Vence el ${formatIsoDay(info.dueDay)}`
      : undefined

  if (variant === 'badge') {
    return (
      <Badge
        data-slot="due-status"
        data-bucket={info.bucket}
        tone={info.tone ?? 'neutral'}
        dot={info.tone !== null}
        title={dateHint}
        className={cn('tabular-nums', className)}
        {...props}
      >
        {label}
      </Badge>
    )
  }

  return (
    <span
      data-slot="due-status"
      data-bucket={info.bucket}
      title={dateHint}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums',
        BUCKET_TEXT_CLASS[info.bucket],
        className,
      )}
      {...props}
    >
      {/* Sin vencimiento no lleva punto, pero guarda su lugar: en una columna
          los textos quedan alineados. */}
      <span
        data-slot="due-status-dot"
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', info.tone && BADGE_DOT_CLASS[info.tone])}
      />
      <span data-slot="due-status-label">{label}</span>
    </span>
  )
}

export { DueStatus }
