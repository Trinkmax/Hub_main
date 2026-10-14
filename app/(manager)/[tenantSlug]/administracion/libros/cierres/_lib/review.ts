import type { CloseStripDay } from '@/components/administracion/charts/close-strip'
import type { StepState } from '@/components/administracion/kit/step'
import {
  addDays,
  addMonthsToYearMonth,
  endOfMonth,
  formatDayMonth,
  formatIsoDay,
  startOfWeek,
  WEEKDAY_NAMES_MIN,
  weekdayName,
  weekdayOf,
} from '@/lib/dates'
import { formatCents, formatCentsShort } from '@/lib/money'
import { closedSentence, monthNoun, monthTitle } from '../../_lib/months'
import { blockerLine, type ChecklistItemLike, infoLine, warningLine } from './checklist'

/**
 * «Fin de mes» en palabras: qué dice el título de la pantalla, qué paso toca y
 * los cuatro renglones de «Revisá los avisos». Puro: arma todo con el checklist
 * de la base, el almanaque de cierres y los datos del bar, y lo prueban los
 * tests.
 *
 * La regla que manda acá: **un «está bien» nunca sale de que la base calle**.
 * La base no avisa «faltan cierres» si el bar nunca cargó uno, ni «cajas sin
 * contar» si la caja no tuvo movimientos, ni «gastos fijos» si vencen el mes
 * que viene. Por eso cada renglón que queda en «Sin avisos» dice, literal, lo
 * que de verdad se revisó, y los cierres del día se miran con el almanaque.
 *
 * Los destinos de cada aviso salen de `warningLine()` / `blockerLine()`
 * (`checklist.ts`), que no cambian.
 */

// ─── Lo que entra ────────────────────────────────────────────────────────────

/** El checklist de la base (`CloseChecklist` lo cumple). */
export type ReviewChecklist = {
  canClose: boolean
  blockers: readonly ChecklistItemLike[]
  warnings: readonly ChecklistItemLike[]
  info: readonly ChecklistItemLike[]
}

/** El almanaque de cierres del mes (`DailyCloseCalendar` lo cumple). */
export type ReviewCalendar = {
  days: ReadonlyArray<{
    date: string
    status: 'loaded' | 'missing' | 'pending' | 'future' | 'before_start'
    totalCents: number | null
  }>
  soldCents: number
  loadedDays: number
  missingDays: number
  serviceDay: string
}

export type ReviewSettings = {
  openingStatus: 'pending' | 'posted' | 'skipped'
  cuit: string | null
}

// ─── El almanaque ────────────────────────────────────────────────────────────

/**
 * Los días del mes para `CloseStrip`: cada día que falta (y hoy) lleva a su cierre.
 *
 * El mes en que el bar arranca no dibuja las semanas ENTERAS anteriores al arranque: eran
 * renglones de números apagados («del 1 al 11») antes del primer día que cuenta. La semana del
 * arranque va completa (sus días previos, apagados), para que el almanaque siga empezando en lunes.
 */
export function closeStripDays(
  calendar: Pick<ReviewCalendar, 'days' | 'serviceDay'>,
  /** `/<bar>/administracion`. `null` = sin links (la contadora no carga). */
  base: string | null,
): CloseStripDay[] {
  const firstUsed = calendar.days.find((day) => day.status !== 'before_start')
  const from = firstUsed ? startOfWeek(firstUsed.date) : null
  const days = from ? calendar.days.filter((day) => day.date >= from) : calendar.days
  return days.map((day) => {
    const state: CloseStripDay['state'] =
      day.status === 'loaded'
        ? 'loaded'
        : day.status === 'missing'
          ? 'missing'
          : day.status === 'pending'
            ? 'today'
            : day.status === 'before_start'
              ? 'before'
              : 'future'
    const loadable = state === 'missing' || state === 'today'
    return {
      date: day.date,
      dayNumber: Number(day.date.slice(8, 10)),
      weekday: WEEKDAY_NAMES_MIN[weekdayOf(day.date)] ?? '',
      state,
      cents: day.totalCents,
      href: base && loadable ? `${base}/ventas/cierre?fecha=${day.date}` : undefined,
      isToday: day.date === calendar.serviceDay,
    }
  })
}

/** «miércoles 07/10». */
function dayWords(iso: string): string {
  return `${weekdayName(iso)} ${formatDayMonth(iso)}`
}

// ─── Los renglones de «Revisá los avisos» ────────────────────────────────────

export type ReviewTone = 'ok' | 'warn' | 'late' | 'muted'

export type ReviewAction =
  | { kind: 'href'; label: string; href: string }
  | {
      kind: 'sheet'
      label: string
      sheet: 'gasto' | 'ajustar'
      params: { caja?: string; 'gasto-fijo'?: string }
    }

/** Un gasto fijo sin cargar, con su «Pagar». */
export type ReviewRecurring = {
  id: string | null
  /** El renglón entero, para el `title` y los lectores: «Alquiler · venció el 10/10 · $ 850.000». */
  text: string
  /** «Alquiler del local». */
  name: string
  /** «venció el 10/10 · $ 850.000»: en el celular va en su propio renglón, debajo del nombre. */
  meta: string
  action: ReviewAction | null
}

export type ReviewItem = {
  /** La clave del aviso (nunca se muestra). */
  key: string
  tone: Exclude<ReviewTone, 'ok'>
  title: string
  detail: string | null
  actions: ReviewAction[]
  /** Hasta 3 gastos fijos con su botón; el resto va en `more`. */
  recurring?: ReviewRecurring[]
  /** «y 28 más». */
  more?: string | null
  /** Letra chica al pie del aviso. */
  note?: string | null
  /** Una ayuda con su link («Ver cómo»). */
  help?: { text: string; label: string; href: string } | null
  /**
   * Algo que todavía no toca (las cajas, a mitad de mes): una sola línea gris con su link, sin
   * botones. No cuenta como aviso.
   */
  soft?: boolean
  /**
   * Sus acciones nunca son EL botón relleno de la pantalla: contar una caja de un mes que ya
   * terminó sirve, pero con la fecha de hoy no apaga el aviso.
   */
  quiet?: boolean
}

export type ReviewRowId = 'closes' | 'purchases' | 'money' | 'papers' | 'other'

export type ReviewRow = {
  id: ReviewRowId
  title: string
  tone: ReviewTone
  /** «Sin avisos» · «1 aviso» · «Falta» · «Sin cierres». */
  pill: string
  /** Cuando no hay nada: la negación literal de lo que se revisó. */
  okText: string | null
  items: ReviewItem[]
  /** El renglón de cierres dibuja el almanaque del mes. */
  showStrip: boolean
  /** Sueldos: el sistema no puede saberlo, así que no lleva tilde ni cuenta como aviso. */
  payroll: { text: string; action: ReviewAction } | null
}

export type CloseReview = {
  rows: ReviewRow[]
  /** Datos para la contadora (no frenan), con el texto de `infoLine()`. */
  info: string[]
  /** Hay algo para hacer en el paso 1 (un aviso, algo que falta, días sin cierre). */
  hasWork: boolean
  /** Lo que frena el cierre además de la fecha y del orden de los meses. */
  blockersCount: number
  /** Si lo único que frena (además de la fecha) es una sola cosa conocida, cómo se dice. */
  blockerWords: string | null
}

/** Las claves que cada renglón se lleva del checklist. */
const ROW_OF: Readonly<Record<string, ReviewRowId>> = {
  missing_daily_closes: 'closes',
  recurring_not_loaded: 'purchases',
  tickets_without_vendor: 'purchases',
  vat_pending_documentation: 'purchases',
  treasuries_not_reconciled: 'money',
  treasury_negative: 'money',
  receivables_overdue: 'money',
  sas_cuit_missing: 'papers',
}

/** Bloqueos que ya dice el título de la pantalla (no son un renglón). */
const HEADLINE_BLOCKERS = new Set(['month_not_finished', 'close_out_of_order'])

const ROW_TITLE: Readonly<Record<ReviewRowId, string>> = {
  closes: 'Cierres del día',
  purchases: 'Compras y gastos',
  money: 'La plata',
  papers: 'Los papeles del bar',
  other: 'Otros avisos',
}

const READER_NOTE = 'Lo cargan los dueños.'

/** La píldora de un renglón que solo tiene cosas que todavía no tocan (mes en curso). */
const SOON_PILL = 'Para ir viendo'

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    : []
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuid(value: unknown): string | null {
  const v = text(value)
  return v && UUID_RE.test(v) ? v : null
}

function pillOf(tone: ReviewTone, items: readonly ReviewItem[], muted = 'Sin dato'): string {
  if (tone === 'ok') return 'Sin avisos'
  if (tone === 'late') return 'Falta'
  if (tone === 'muted') return muted
  const count = Math.max(1, items.filter((i) => i.tone === 'warn').length)
  return count === 1 ? '1 aviso' : `${count} avisos`
}

function rowTone(items: readonly ReviewItem[]): ReviewTone {
  if (items.some((i) => i.tone === 'late')) return 'late'
  if (items.some((i) => i.tone === 'warn')) return 'warn'
  if (items.some((i) => i.tone === 'muted')) return 'muted'
  return 'ok'
}

export type ReviewInput = {
  /** `yyyy-MM`. */
  month: string
  /** `/<bar>/administracion`. */
  base: string
  /** El mes ya terminó (su último día es anterior a hoy). */
  finished: boolean
  /**
   * Hoy (`yyyy-MM-dd`). En un mes en curso separa lo que ya venció de lo que vence más adelante;
   * sin la fecha, todo lo que avisa la base se cuenta como aviso.
   */
  today?: string
  canWrite: boolean
  checklist: ReviewChecklist
  /** `null` si no se pudo leer: el renglón usa solo el aviso de la base, sin dibujo. */
  calendar: ReviewCalendar | null
  /** `null` si no se pudieron leer los datos del bar. */
  settings: ReviewSettings | null
}

/** Los cierres del día, mirando el almanaque (no el silencio de la base). */
function closesRow(input: ReviewInput): ReviewRow {
  const { calendar, base, month, canWrite, finished } = input
  const noun = monthNoun(month)
  const fromBase = input.checklist.warnings.find((w) => w.key === 'missing_daily_closes') ?? null
  const items: ReviewItem[] = []
  let okText: string | null = null
  let showStrip = false

  if (!calendar) {
    if (fromBase) {
      const line = warningLine(fromBase, base)
      items.push({
        key: fromBase.key,
        tone: 'warn',
        title: 'Faltan cierres del día',
        detail: line.detail,
        actions: line.href ? [{ kind: 'href', label: 'Cargar', href: line.href }] : [],
      })
    } else {
      items.push({
        key: 'closes_unknown',
        tone: 'muted',
        title: `No pudimos mirar los cierres del día de ${noun}`,
        detail: 'Están en Ventas, día por día.',
        actions: [{ kind: 'href', label: 'Ver las ventas del mes', href: `${base}/ventas` }],
      })
    }
  } else {
    const loaded = calendar.loadedDays
    const missing = calendar.missingDays
    const total = loaded + missing
    const firstMissing = calendar.days.find((d) => d.status === 'missing')?.date ?? null
    const pending = calendar.days.find((d) => d.status === 'pending')?.date ?? null
    showStrip = true

    if (missing === 0 && loaded > 0) {
      okText = finished
        ? loaded === 1
          ? `El único día de ${noun} en los libros tiene su cierre.`
          : `Los ${loaded} días de ${noun} tienen su cierre.`
        : loaded === 1
          ? `Vas al día: el día que va de ${noun} tiene su cierre.`
          : `Vas al día: están los ${loaded} días que van de ${noun}.`
      showStrip = false
    } else if (missing > 0 && loaded > 0) {
      items.push({
        key: 'missing_daily_closes',
        tone: 'warn',
        title: missing === 1 ? 'Falta 1 cierre del día' : `Faltan ${missing} cierres del día`,
        detail: `Cargaste ${loaded} de ${total}.${
          firstMissing ? ` El primero que falta es el ${dayWords(firstMissing)}.` : ''
        }`,
        actions: firstMissing
          ? [
              {
                kind: 'href',
                label: `Cargar el del ${dayWords(firstMissing)}`,
                href: `${base}/ventas/cierre?fecha=${firstMissing}`,
              },
            ]
          : [],
      })
    } else if (missing > 0) {
      // Ninguno en el mes: la base calla (nunca se cargó un cierre), el almanaque no.
      items.push({
        key: 'no_daily_closes',
        tone: 'muted',
        title: `Todavía no hay ningún cierre del día en ${noun}`,
        detail: 'Sin cierres, el mes queda sin ventas en los libros.',
        actions: firstMissing
          ? [
              {
                kind: 'href',
                label: `Cargar el del ${dayWords(firstMissing)}`,
                href: `${base}/ventas/cierre?fecha=${firstMissing}`,
              },
            ]
          : [],
        help: canWrite
          ? {
              text: 'Como no hay punto de venta conectado, el cierre se carga a mano, una vez por día.',
              label: 'Ver cómo',
              href: `${base}/guias/dia-a-dia#receta-cierre`,
            }
          : null,
      })
    } else {
      // Ni cargados ni faltantes: el mes recién empieza (o todavía no llegó a su primer día).
      items.push({
        key: 'no_days_yet',
        tone: 'muted',
        title: `${monthTitle(month)} recién empieza: todavía no hay ningún día para cerrar`,
        detail: pending ? `El primero es el de hoy, ${dayWords(pending)}.` : null,
        actions: pending
          ? [
              {
                kind: 'href',
                label: `Cargar el del ${dayWords(pending)}`,
                href: `${base}/ventas/cierre?fecha=${pending}`,
              },
            ]
          : [],
      })
    }
  }

  const tone = rowTone(items)
  return {
    id: 'closes',
    title: ROW_TITLE.closes,
    tone,
    pill: pillOf(tone, items, calendar ? 'Sin cierres' : 'Sin dato'),
    okText,
    items,
    showStrip,
    payroll: null,
  }
}

function purchasesItem(item: ChecklistItemLike, input: ReviewInput): ReviewItem {
  const { base, month, canWrite } = input
  const noun = monthNoun(month)
  const d = item.detail
  const count = item.count ?? num(d.count)
  const amount = item.amountCents ?? num(d.amount_cents)
  switch (item.key) {
    case 'recurring_not_loaded': {
      const all = records(d.items)
      const today = input.today ?? null
      const dueOf = (r: Record<string, unknown>) => text(r.due_date)?.slice(0, 10) ?? null
      // En un mes terminado todo venció; en uno en curso, lo anterior a hoy. Sin fecha de
      // vencimiento no se puede decir que falte tiempo: cuenta como vencido.
      const isPast = (due: string | null) =>
        input.finished || due === null || (today !== null && due < today)
      const rows: ReviewRecurring[] = all.slice(0, 3).map((r) => {
        const id = uuid(r.recurring_id)
        const due = dueOf(r)
        const cents = num(r.amount_cents)
        const name = text(r.name) ?? 'Gasto fijo'
        const when = !due
          ? null
          : isPast(due)
            ? `venció el ${formatDayMonth(due)}`
            : due === today
              ? 'vence hoy'
              : `vence el ${formatDayMonth(due)}`
        const meta = [when, cents !== null && cents > 0 ? formatCentsShort(cents) : 'sin monto']
          .filter(Boolean)
          .join(' · ')
        return {
          id,
          text: `${name} · ${meta}`,
          name,
          meta,
          action: id
            ? { kind: 'sheet', label: 'Pagar', sheet: 'gasto', params: { 'gasto-fijo': id } }
            : null,
        }
      })
      const rest = Math.max(0, (count ?? all.length) - rows.length)
      // A mitad de mes, un gasto fijo que vence el 15 no es un atraso: si ninguno venció, el
      // renglón no cuenta como aviso (la lista viene ordenada por vencimiento).
      const noneDue = !input.finished && today !== null && !all.some((r) => isPast(dueOf(r)))
      return {
        key: item.key,
        tone: noneDue ? 'muted' : 'warn',
        title: noneDue
          ? `Gastos fijos de ${noun} que todavía no vencieron`
          : `Hay gastos fijos de ${noun} sin cargar`,
        detail: null,
        recurring: rows,
        more: rest > 0 ? `y ${rest} más` : null,
        actions: [{ kind: 'href', label: 'Ver gastos fijos', href: `${base}/gastos-fijos` }],
        note: canWrite ? 'Si este mes no se paga, marcalo en Gastos fijos.' : null,
      }
    }
    case 'tickets_without_vendor':
      return {
        key: item.key,
        tone: 'warn',
        title:
          count === 1
            ? '1 tique no dice de qué comercio es'
            : count !== null
              ? `${count} tiques no dicen de qué comercio son`
              : 'Hay tiques que no dicen de qué comercio son',
        detail: `${
          amount !== null ? `Por ${formatCentsShort(amount)}. ` : ''
        }Así no entran al Libro IVA; igual quedan registrados.`,
        actions: [{ kind: 'href', label: 'Ver', href: `${base}/compras?tab=comprobantes` }],
      }
    default:
      // vat_pending_documentation
      return {
        key: item.key,
        tone: 'warn',
        title: 'Falta la factura de las comisiones',
        detail:
          amount !== null
            ? `Te descontaron ${formatCentsShort(amount)} de IVA en tarjetas o apps y todavía no cargaste su factura.`
            : 'Te descontaron IVA en tarjetas o apps y todavía no cargaste su factura.',
        actions: [{ kind: 'href', label: 'Cargar la factura', href: `${base}/compras/nueva` }],
      }
  }
}

function moneyItem(item: ChecklistItemLike, input: ReviewInput): ReviewItem {
  const { base, month, canWrite } = input
  const noun = monthNoun(month)
  const d = item.detail
  const count = item.count ?? num(d.count)
  const amount = item.amountCents ?? num(d.amount_cents)
  switch (item.key) {
    case 'treasuries_not_reconciled': {
      const treasuries = records(d.treasuries)
      const actions = treasuries.flatMap((t): ReviewAction[] => {
        const id = uuid(t.treasury_id)
        const name = text(t.name)
        return id && name
          ? [{ kind: 'sheet', label: `Contar ${name}`, sheet: 'ajustar', params: { caja: id } }]
          : []
      })
      const names = treasuries.map((t) => text(t.name)).filter((n): n is string => n !== null)
      const seeAll: ReviewAction = { kind: 'href', label: 'Ver cajas', href: `${base}/cajas` }
      // A mitad de mes no es un aviso: alcanza con contarlas una vez antes de cerrar. Va como
      // una línea gris con su link, sin un botón por caja.
      if (!input.finished) {
        return {
          key: item.key,
          tone: 'muted',
          soft: true,
          title: `Las cajas de ${noun} se cuentan antes de cerrar el mes.`,
          detail: names.length > 0 ? `Todavía sin contar: ${names.join(', ')}.` : null,
          actions: [seeAll],
        }
      }
      return {
        key: item.key,
        tone: 'warn',
        title: `Hay cajas sin contar en ${noun}`,
        // La base da por contada una caja solo si el conteo tiene fecha DENTRO del mes, y la hoja
        // abre con la fecha de hoy: hay que decirlo, o se cuenta y el aviso sigue.
        detail: canWrite
          ? `Contalas con fecha de ${noun} (por ejemplo, ${formatDayMonth(endOfMonth(month))}) para que valga para este mes.`
          : names.length > 0
            ? `Sin contar: ${names.join(', ')}.`
            : null,
        // Si la base no dijo cuáles, queda el camino general.
        actions: actions.length === 0 ? [seeAll] : actions,
        // Con la fecha de hoy no apaga el aviso: no puede ser EL botón de la pantalla.
        quiet: true,
      }
    }
    case 'treasury_negative': {
      const list = records(d.treasuries)
      const first = list[0]
      const name = first ? (text(first.name) ?? 'Caja') : 'Caja'
      const balance = first ? num(first.balance_cents) : null
      return {
        key: item.key,
        tone: 'warn',
        title:
          list.length > 1
            ? `${list.length} cajas quedaron en negativo`
            : 'Una caja quedó en negativo',
        detail: `${
          balance !== null
            ? `${name}: ${formatCentsShort(Math.abs(balance))} en descubierto al ${formatDayMonth(endOfMonth(month))}. `
            : ''
        }Suele ser una entrada sin cargar.`,
        actions: [{ kind: 'href', label: 'Ver cajas', href: `${base}/cajas` }],
      }
    }
    default:
      // receivables_overdue
      return {
        key: item.key,
        tone: 'warn',
        title: 'Hay plata en camino atrasada',
        detail:
          count !== null && amount !== null
            ? `${count === 1 ? '1 cobro' : `${count} cobros`} por ${formatCentsShort(amount)} ya ${
                count === 1 ? 'tendría' : 'tendrían'
              } que haber entrado.`
            : null,
        actions: [
          { kind: 'href', label: 'Ver plata por cobrar', href: `${base}/ventas?tab=clientes` },
        ],
      }
  }
}

/** Los papeles del bar: de los datos del bar (o, si no se leyeron, de lo que diga la base). */
function papersRow(input: ReviewInput): ReviewRow {
  const { settings, checklist, base } = input
  const items: ReviewItem[] = []
  const openingPending = settings
    ? settings.openingStatus === 'pending'
    : checklist.blockers.some((b) => b.key === 'opening_pending')
  const cuitMissing = settings
    ? !settings.cuit
    : checklist.warnings.some((w) => w.key === 'sas_cuit_missing')

  if (openingPending) {
    items.push({
      key: 'opening_pending',
      tone: 'late',
      title: 'Falta decir cuánta plata había al arrancar',
      detail: 'O elegir «Arrancar en cero». Sin eso no se puede cerrar el primer mes.',
      actions: [{ kind: 'href', label: 'Cargar lo que había', href: `${base}/configurar` }],
    })
  }
  if (cuitMissing) {
    items.push({
      key: 'sas_cuit_missing',
      tone: 'warn',
      title: 'Falta la CUIT del bar',
      detail: 'Sin la CUIT no se pueden descargar los libros de IVA.',
      actions: [{ kind: 'href', label: 'Cargarla', href: `${base}/ajustes?tab=sas` }],
    })
  }
  // Sin los datos del bar y sin nada que diga la base, no se afirma que estén cargados.
  if (!settings && items.length === 0) {
    items.push({
      key: 'papers_unknown',
      tone: 'muted',
      title: 'No pudimos leer los datos del bar',
      detail: 'Recargá la página para ver si falta la CUIT o lo que había al arrancar.',
      actions: [],
    })
  }
  const tone = rowTone(items)
  return {
    id: 'papers',
    title: ROW_TITLE.papers,
    tone,
    pill: pillOf(tone, items),
    okText: items.length === 0 ? 'La CUIT y lo que había al arrancar están cargados.' : null,
    items,
    showStrip: false,
    payroll: null,
  }
}

/** Lo que frena el cierre, dicho en una frase para el título («decir cuánta plata había…»). */
const BLOCKER_WORDS: Readonly<Record<string, string>> = {
  opening_pending: 'decir cuánta plata había al arrancar',
}

/**
 * Los cuatro renglones de «Revisá los avisos», siempre en el mismo orden, más
 * «Otros avisos» si la base manda algo que esta versión no conoce (con el texto
 * general: nunca se muestra una clave).
 */
export function closeReview(input: ReviewInput): CloseReview {
  const { checklist, month, base, canWrite } = input
  const noun = monthNoun(month)

  const purchases: ReviewItem[] = []
  const money: ReviewItem[] = []
  const other: ReviewItem[] = []
  for (const warning of checklist.warnings) {
    const row = ROW_OF[warning.key]
    if (row === 'closes' || row === 'papers') continue
    if (row === 'purchases') purchases.push(purchasesItem(warning, input))
    else if (row === 'money') money.push(moneyItem(warning, input))
    else {
      const line = warningLine(warning, base)
      other.push({
        key: warning.key,
        tone: 'warn',
        // Una clave que no se conoce se dice en general.
        title: line.text,
        detail: line.detail,
        actions:
          line.href && line.linkLabel
            ? [{ kind: 'href', label: line.linkLabel, href: line.href }]
            : [],
      })
    }
  }
  // Un bloqueo que no es la fecha, el orden ni el arranque: también va a «Otros avisos».
  const extraBlockers = checklist.blockers.filter(
    (b) => !HEADLINE_BLOCKERS.has(b.key) && b.key !== 'opening_pending',
  )
  for (const blocker of extraBlockers) {
    const line = blockerLine(blocker, base, { first: `${month}-01`, endsOn: null })
    other.push({ key: blocker.key, tone: 'late', title: line.text, detail: null, actions: [] })
  }

  const closes = closesRow(input)
  const papers = papersRow(input)

  const purchasesTone = rowTone(purchases)
  const moneyTone = rowTone(money)
  const rows: ReviewRow[] = [
    closes,
    {
      id: 'purchases',
      title: ROW_TITLE.purchases,
      tone: purchasesTone,
      pill: pillOf(purchasesTone, purchases, SOON_PILL),
      okText:
        purchases.length === 0
          ? `No hay gastos fijos de ${noun} sin cargar ni tiques sin comercio.`
          : null,
      items: purchases,
      showStrip: false,
      payroll: canWrite
        ? {
            text: `Sueldos del mes: el sistema no sabe si ya los cargaste. Si tu contadora te pasó los números de ${noun}, van acá.`,
            action: {
              kind: 'href',
              label: 'Cargar los sueldos',
              href: `${base}/libros/asiento-manual?tipo=sueldos`,
            },
          }
        : null,
    },
    {
      id: 'money',
      title: ROW_TITLE.money,
      tone: moneyTone,
      pill: pillOf(moneyTone, money, SOON_PILL),
      okText:
        money.length === 0 ? 'Ninguna caja con movimientos quedó sin contar ni en negativo.' : null,
      items: money,
      showStrip: false,
      payroll: null,
    },
    papers,
  ]
  if (other.length > 0) {
    const tone = rowTone(other)
    rows.push({
      id: 'other',
      title: ROW_TITLE.other,
      tone,
      pill: pillOf(tone, other),
      okText: null,
      items: other,
      showStrip: false,
      payroll: null,
    })
  }

  // La contadora ve los mismos renglones, sin un solo botón: donde iba la acción, quién lo carga.
  if (!canWrite) {
    for (const row of rows) {
      for (const item of row.items) {
        item.actions = []
        item.help = null
        if (item.recurring) item.recurring = item.recurring.map((r) => ({ ...r, action: null }))
        item.note = READER_NOTE
      }
    }
  }

  const openingBlocks = checklist.blockers.some((b) => b.key === 'opening_pending')
  const blockers = [
    ...(openingBlocks ? ['opening_pending'] : []),
    ...extraBlockers.map((b) => b.key),
  ]
  const only = blockers.length === 1 ? blockers[0] : undefined
  return {
    rows,
    info: checklist.info
      .map(infoLine)
      .filter((l): l is NonNullable<ReturnType<typeof infoLine>> => l !== null)
      .map((l) => l.text),
    hasWork: rows.some((r) => r.tone !== 'ok'),
    blockersCount: blockers.length,
    blockerWords: only ? (BLOCKER_WORDS[only] ?? null) : null,
  }
}

/** La primera acción del paso 1, en el orden de los renglones: es EL botón primario de la pantalla. */
export function firstReviewAction(review: Pick<CloseReview, 'rows'>): ReviewAction | null {
  for (const row of review.rows) {
    for (const item of row.items) {
      // Lo que todavía no toca, o lo que hoy no apaga su aviso, nunca es el botón relleno.
      if (item.soft || item.quiet) continue
      const recurring = item.recurring?.find((r) => r.action)?.action
      if (recurring) return recurring
      const [first] = item.actions
      if (first) return first
    }
  }
  return null
}

// ─── El título de la pantalla ────────────────────────────────────────────────

export type CloseHeadline = {
  /** La afirmación (va en negrita). */
  lead: string
  /** Lo que sigue (en gris). */
  rest: string | null
  link: { label: string; href: string } | null
}

function avisosText(count: number, one: string, many: (n: number) => string): string {
  return count === 1 ? one : many(count)
}

/**
 * La afirmación del mes en «Fin de mes». El número de avisos es el de la base
 * (`checklist.warnings.length`): el mismo que usan el Resumen y el diálogo de
 * «Cerrar».
 */
export function closeHeadline(input: {
  /** `yyyy-MM`. */
  month: string
  period: {
    endsOn: string
    status: 'open' | 'closed'
    closedAt: string | null
    closedByName: string | null
  }
  today: string
  canWrite: boolean
  /** `null` si no se pudo leer (o el mes está cerrado). */
  checklist: ReviewChecklist | null
  /** Lo que frena además de la fecha y del orden (`closeReview().blockersCount`). */
  blockersCount: number
  blockerWords: string | null
  /** El primer mes abierto anterior, si hay (`yyyy-MM`). */
  earlierOpen: string | null
  /** `/<bar>/administracion/libros/cierres`. */
  path: string
}): CloseHeadline {
  const { month, period, today, canWrite, checklist, earlierOpen } = input
  const name = monthTitle(month)
  const noun = monthNoun(month)

  if (period.status === 'closed') {
    return {
      lead: `${name} está cerrado.`,
      rest: canWrite
        ? `${closedSentence(period)} Ya le podés mandar los libros a tu contadora.`
        : closedSentence(period),
      link: null,
    }
  }

  const finished = period.endsOn < today
  const warnings = checklist?.warnings.length ?? 0

  if (!canWrite) {
    const avisos = !checklist
      ? null
      : warnings === 0
        ? 'No tiene avisos.'
        : avisosText(warnings, 'Tiene 1 aviso.', (n) => `Tiene ${n} avisos.`)
    return {
      lead: `${name} sigue abierto: lo cierran los dueños.`,
      rest: [finished ? null : 'Todavía no terminó.', avisos].filter(Boolean).join(' ') || null,
      link: null,
    }
  }

  if (!finished) {
    const from = formatIsoDay(addDays(period.endsOn, 1))
    const blockers = input.blockersCount
    const rest =
      blockers === 1 && input.blockerWords
        ? `Se puede cerrar desde el ${from}, y antes falta 1 cosa: ${input.blockerWords}.`
        : blockers > 0
          ? `Se puede cerrar desde el ${from}, y antes ${
              blockers === 1 ? 'falta 1 cosa' : `faltan ${blockers} cosas`
            }: están abajo.`
          : earlierOpen
            ? `Se puede cerrar desde el ${from}, una vez cerrado ${monthNoun(earlierOpen)}. Abajo está lo que conviene ir dejando listo.`
            : `Se puede cerrar desde el ${from}. Abajo está lo que conviene ir dejando listo.`
    return { lead: `${name} todavía no terminó.`, rest, link: null }
  }

  if (earlierOpen) {
    return {
      lead: `Antes de ${noun} hay que cerrar ${monthNoun(earlierOpen)}.`,
      rest: 'Los meses se cierran en orden.',
      link: { label: `Ir a ${monthNoun(earlierOpen)}`, href: `${input.path}?mes=${earlierOpen}` },
    }
  }

  if (!checklist) {
    return {
      lead: `${name} terminó y falta cerrarlo.`,
      rest: 'No pudimos leer qué le falta: recargá la página.',
      link: null,
    }
  }

  if (!checklist.canClose) {
    const blockers = Math.max(1, input.blockersCount)
    return {
      lead: `A ${noun} ${blockers === 1 ? 'le falta 1 cosa' : `le faltan ${blockers} cosas`} para poder cerrarse.`,
      rest:
        warnings > 0
          ? avisosText(
              warnings,
              'Además hay 1 aviso, que no frena.',
              (n) => `Además hay ${n} avisos, que no frenan.`,
            )
          : null,
      link: null,
    }
  }

  if (warnings > 0) {
    return {
      lead: `${name} se puede cerrar.`,
      rest: avisosText(
        warnings,
        'Queda 1 aviso para mirar: no frena el cierre.',
        (n) => `Quedan ${n} avisos para mirar: no frenan el cierre.`,
      ),
      link: null,
    }
  }
  return { lead: `${name} está listo para cerrar.`, rest: 'No hay avisos.', link: null }
}

// ─── Qué paso toca ───────────────────────────────────────────────────────────

/**
 * El estado de los tres pasos (revisar · cerrar · mandar). Uno solo es
 * `current` a la vez: el que toca.
 */
export function stepStates(input: {
  closed: boolean
  /** La base deja cerrarlo (sin bloqueos y abierto). */
  canClose: boolean
  /** Hay algo para hacer en el paso 1 (`closeReview().hasWork`). */
  hasWork: boolean
}): [StepState, StepState, StepState] {
  if (input.closed) return ['done', 'done', 'current']
  if (input.canClose)
    return input.hasWork ? ['current', 'todo', 'todo'] : ['done', 'current', 'todo']
  return [input.hasWork ? 'current' : 'done', 'todo', 'todo']
}

/** «Se puede desde el 01/11/2026.» y sus pares: por qué todavía no se puede cerrar. */
export function closeWaitText(input: {
  month: string
  period: { endsOn: string }
  today: string
  earlierOpen: string | null
  openingPending: boolean
  blockersCount: number
}): string {
  if (input.period.endsOn >= input.today) {
    return `Se puede desde el ${formatIsoDay(addDays(input.period.endsOn, 1))}.`
  }
  if (input.earlierOpen) return `Primero hay que cerrar ${monthNoun(input.earlierOpen)}.`
  if (input.openingPending && input.blockersCount === 1) {
    return 'Antes falta decir cuánta plata había al arrancar (paso 1).'
  }
  return 'Hay algo que no deja cerrar este mes todavía.'
}

// ─── El IVA que toma el cierre ───────────────────────────────────────────────

/** Lo que hace falta de la posición del checklist (`CloseChecklistIva` lo cumple). */
export type CloseIva = {
  applies: boolean
  mode: 'on_close' | 'manual' | null
  willGenerate: boolean
  replacesDocumentId: string | null
  toPayCents: number
  inFavorCents: number
  isZero: boolean
  settlementDocumentId: string | null
}

export type IvaClosePlan = {
  /** El cierre anota el IVA (lo genera, o reemplaza o anula el que quedó viejo). */
  settles: boolean
  /** Hay uno viejo que se reemplaza: ahí el interruptor no se puede apagar. */
  replaces: boolean
  /** No genera nada: solo anula el que había (el mes ahora da cero). */
  voidsOnly: boolean
  /** La oración del paso 2, en partes para resaltar el importe. `null` si no hay nada que decir. */
  text: { lead: string; amount: string | null; tail: string } | null
  /** La frase del diálogo de «Cerrar» (vacía si el cierre no toca el IVA). */
  summary: string
}

/**
 * Qué hace el cierre con el IVA del mes, con las MISMAS ramas de siempre: en
 * modo «al cerrar» (responsable inscripto) el cierre lo anota si hace falta
 * (`willGenerate`) y reemplaza el que quedó viejo (`replacesDocumentId`),
 * también cuando el mes ahora da cero (lo anula). Acá solo cambian las palabras.
 */
export function ivaClosePlan(iva: CloseIva | null, month: string): IvaClosePlan {
  const noun = monthNoun(month)
  const onClose = Boolean(iva?.applies && iva.mode === 'on_close')
  const replaces = Boolean(onClose && iva?.replacesDocumentId)
  const settles = Boolean(onClose && iva && (iva.willGenerate || replaces))
  const voidsOnly = Boolean(settles && iva && !iva.willGenerate)
  const plan = { settles, replaces, voidsOnly }
  if (!iva?.applies) return { ...plan, text: null, summary: '' }

  if (voidsOnly) {
    const what = `se anula el IVA que había quedado anotado: ahora ${noun} da cero.`
    return {
      ...plan,
      text: { lead: `Al cerrar ${what}`, amount: null, tail: '' },
      summary: `Se anula el IVA que había quedado anotado: ahora ${noun} da cero.`,
    }
  }
  if (settles) {
    const again = replaces ? ' Reemplaza al que había quedado viejo.' : ''
    const lead = `Al cerrar queda anotado el IVA de ${noun}: `
    // La oración de la pantalla va en pesos, como el papel del mes y «¿Cómo se calcula?»; el
    // importe exacto (con centavos) queda en el diálogo de «Cerrar» y en la cuenta completa.
    if (iva.toPayCents > 0) {
      return {
        ...plan,
        text: {
          lead,
          amount: formatCentsShort(iva.toPayCents),
          tail: ` a pagarle a ARCA.${again}`,
        },
        summary: `Queda anotado el IVA de ${noun}: a pagar ${formatCents(iva.toPayCents)}.${again}`,
      }
    }
    if (iva.inFavorCents > 0) {
      const next = monthNoun(addMonthsToYearMonth(month.slice(0, 7), 1))
      return {
        ...plan,
        text: {
          lead: `${lead}quedan `,
          amount: formatCentsShort(iva.inFavorCents),
          tail: ` a favor para ${next}.${again}`,
        },
        summary: `Queda anotado el IVA de ${noun}: quedan ${formatCents(iva.inFavorCents)} a favor.${again}`,
      }
    }
    return {
      ...plan,
      text: { lead: `${lead}no queda nada a pagar.${again}`, amount: null, tail: '' },
      summary: `Queda anotado el IVA de ${noun}: no queda nada a pagar.${again}`,
    }
  }
  if (iva.isZero) {
    return {
      ...plan,
      text: { lead: `${monthTitle(month)} no tiene IVA para anotar.`, amount: null, tail: '' },
      summary: '',
    }
  }
  if (iva.mode === 'manual') {
    return {
      ...plan,
      text: {
        lead: 'El IVA de este mes se anota a mano, desde El IVA del mes.',
        amount: null,
        tail: '',
      },
      summary: '',
    }
  }
  if (iva.settlementDocumentId) {
    return {
      ...plan,
      text: { lead: `El IVA de ${noun} ya está anotado.`, amount: null, tail: '' },
      summary: '',
    }
  }
  return { ...plan, text: null, summary: '' }
}
