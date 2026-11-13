/**
 * El turno resumido — PURO y testeado.
 *
 * Lo que se lee al cerrar («Cerro, noche: $ 2.340.000 · 143 personas · $ 16.360 por persona») y lo
 * que viaja por WhatsApp a los dueños salen de acá, del mismo armado: así el papel que se ve en la
 * pantalla y el texto que se comparte nunca dicen cosas distintas.
 *
 * Trabaja sobre `ShiftSummary`: la foto que quedó al cerrar o los números en vivo de un turno
 * abierto. No recalcula plata: ordena y escribe lo que la base ya sumó, con quién hizo cada cosa.
 */
import { formatCentsShort } from '@/lib/money'
import { clockAt } from '@/lib/pos/order/clock'
import { dayLabel, differenceWords } from './screen'
import { methodChangeLabel } from './shift'
import {
  type DiscountKind,
  METHOD_LABEL,
  type Shift,
  type ShiftSummary,
  type SummaryCorrection,
} from './types'

export type ReportTone = 'strong' | 'good' | 'warn' | 'bad'

export type ReportLine = {
  label: string
  /** El monto o la cantidad, ya escrito. */
  value: string | null
  /** Quién, cuándo, por qué. */
  detail: string | null
  /** El detalle es corto («4 cobros»): en pantalla va al lado del rótulo, no abajo. */
  inline?: boolean
  tone?: ReportTone
}

export type ReportSection = {
  key: 'in' | 'tables' | 'drawer' | 'watch'
  title: string
  lines: ReportLine[]
  /** Una aclaración al pie de la sección. */
  foot: string | null
}

export type ShiftReport = {
  /** «Cerro, noche: $ 261.800 · 14 personas · $ 18.700 por persona». */
  headline: string
  /** El número grande y la oración que lo explica. */
  hero: { cents: number; sentence: string }
  /** «Jueves 12/11 · de 20:14 a 02:10 · abrió Caro, cerró Caro». */
  meta: string
  closed: boolean
  /** Cómo dio el arqueo. `null` mientras el turno sigue abierto. */
  difference: ReturnType<typeof differenceWords> | null
  sections: ReportSection[]
  /** La nota de quien cerró. */
  note: string | null
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const money = (cents: number) => formatCentsShort(cents)
const table = (label: string | null) => (label ? `mesa ${label}` : 'sin mesa')
const quote = (text: string | null | undefined) => (text?.trim() ? `«${text.trim()}»` : null)
const join = (parts: ReadonlyArray<string | null | undefined>, glue = ' · ') =>
  parts.filter((part): part is string => Boolean(part)).join(glue) || null

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «10 %», «12,5 %» o «$ 5.000»: un descuento como se dice en la mesa. */
export function discountLabel(kind: DiscountKind, value: number): string {
  if (kind === 'amount') return money(value)
  return `${String(value / 100).replace('.', ',')} %`
}

/** «Cerro, noche», «Cerro, caja barra, noche». */
export function shiftPlace(
  branchName: string,
  shift: Pick<Shift, 'label' | 'register'>,
  registersCount = 1,
): string {
  const rest = [registersCount > 1 ? shift.register : null, shift.label]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim().toLowerCase())
  return [branchName.trim(), ...rest].join(', ')
}

/** Las correcciones de un mismo toque (el medio y el recargo que se fue con él), juntas. */
function groupCorrections(corrections: ReadonlyArray<SummaryCorrection>): SummaryCorrection[][] {
  const groups: SummaryCorrection[][] = []
  for (const correction of corrections) {
    const group = groups.find((candidate) => {
      const head = candidate[0]
      return (
        head !== undefined &&
        head.payment_id === correction.payment_id &&
        head.at === correction.at &&
        head.by_name === correction.by_name
      )
    })
    if (group) group.push(correction)
    else groups.push([correction])
  }
  return groups
}

function correctionChange(correction: SummaryCorrection): string {
  if (correction.field === 'method') {
    return methodChangeLabel(correction.old_value, correction.new_value)
  }
  if (correction.field === 'invoice') {
    return correction.new_value === 'true' ? 'pasó a con factura' : 'pasó a sin factura'
  }
  return `recargo ${money(Number(correction.old_value))} → ${money(Number(correction.new_value))}`
}

const CORRECTION_ORDER: Readonly<Record<SummaryCorrection['field'], number>> = {
  method: 0,
  surcharge_cents: 1,
  invoice: 2,
}

export function buildShiftReport(input: {
  branchName: string
  shift: Shift
  /** La foto del cierre (`shift.summary`) o, con el turno abierto, los números en vivo. */
  summary: ShiftSummary
  timeZone: string
  registersCount?: number
  /**
   * Los números recalculados hoy de un turno ya cerrado: si un dueño corrigió algo después del
   * cierre, el efectivo esperado ya no es el que quedó en la foto, y se dice.
   */
  liveAfter?: ShiftSummary | null
}): ShiftReport {
  const { shift, summary, timeZone } = input
  const closed = shift.status === 'closed'
  const place = shiftPlace(input.branchName, shift, input.registersCount ?? 1)

  // ── El número grande ──
  const perPerson = summary.per_person_cents
  const hasTables = summary.tables > 0 && summary.people > 0 && perPerson !== null
  const heroCents = hasTables ? summary.consumption_cents : summary.collected_cents
  const peopleWords = `${summary.people} ${plural(summary.people, 'persona', 'personas')}`
  const tablesWords = `${summary.tables} ${plural(summary.tables, 'mesa', 'mesas')}`
  const cobros = `${summary.payments_count} ${plural(summary.payments_count, 'cobro', 'cobros')}`
  const headline = hasTables
    ? `${place}: ${money(heroCents)} · ${peopleWords} · ${money(perPerson ?? 0)} por persona`
    : `${place}: ${money(heroCents)} en ${cobros}`
  const sentence = hasTables
    ? `Es lo que consumieron ${peopleWords} en ${tablesWords}: ${money(perPerson ?? 0)} por persona.`
    : summary.payments_count > 0
      ? `Es lo que entró en ${cobros}.`
      : 'En este turno no entró ningún cobro.'

  // ── Cuándo y quién ──
  const opened = clockAt(shift.opened_at, timeZone)
  const hours = shift.closed_at
    ? `de ${opened} a ${clockAt(shift.closed_at, timeZone)}`
    : `abierto desde las ${opened}`
  const who = shift.closed_by_name
    ? `abrió ${shift.opened_by_name}, cerró ${shift.closed_by_name}`
    : `abrió ${shift.opened_by_name}`
  const meta = `${capitalize(dayLabel(shift.service_day, 'long'))} · ${hours} · ${who}`

  // ── Lo que entró ──
  const inLines: ReportLine[] = summary.by_method.map((row) => ({
    label: METHOD_LABEL[row.method],
    value: money(row.total_cents),
    detail: `${row.count} ${plural(row.count, 'cobro', 'cobros')}`,
    inline: true,
  }))
  if (summary.by_method.length > 1) {
    inLines.push({
      label: 'Total',
      value: money(summary.collected_cents),
      detail: null,
      tone: 'strong',
    })
  }
  if (summary.payments_count > 0) {
    inLines.push(
      { label: 'Con factura', value: money(summary.invoiced_cents), detail: null },
      { label: 'Sin factura', value: money(summary.not_invoiced_cents), detail: null },
    )
  }
  const extras = join(
    [
      summary.tip_cents > 0 ? `${money(summary.tip_cents)} de propinas, que van aparte` : null,
      summary.surcharge_cents > 0
        ? `${money(summary.surcharge_cents)} de recargo de crédito`
        : null,
    ],
    ' y ',
  )

  // ── Las mesas ──
  const tableLines: ReportLine[] = []
  if (summary.tables > 0) {
    tableLines.push({
      label: 'Consumo de las mesas cerradas',
      value: money(summary.consumption_cents),
      detail: join([tablesWords, summary.people > 0 ? peopleWords : null]),
    })
    if (perPerson !== null) {
      tableLines.push({ label: 'Por persona', value: money(perPerson), detail: null })
    }
  }
  if (summary.discount_cents > 0) {
    tableLines.push({
      label: 'Descuentos',
      value: money(summary.discount_cents),
      detail: 'ya restados del consumo',
    })
  }
  for (const deposit of summary.deposits) {
    tableLines.push({
      label: `Seña ya cobrada · ${table(deposit.table_label)}`,
      value: money(deposit.amount_cents),
      detail: join([deposit.name, 'no pasó por la caja hoy']),
    })
  }
  if (summary.open_tables.count > 0) {
    const n = summary.open_tables.count
    tableLines.push({
      label: closed ? 'Quedaron abiertas' : 'Siguen abiertas',
      value: `${n} ${plural(n, 'mesa', 'mesas')}`,
      detail:
        summary.open_tables.pending_cents > 0
          ? `${money(summary.open_tables.pending_cents)} sin cobrar`
          : 'sin nada para cobrar',
      tone: closed ? 'warn' : undefined,
    })
  }

  // ── El cajón ──
  const drawerLines: ReportLine[] = [
    {
      label: 'Cambio con el que se abrió',
      value: money(summary.opening_float_cents),
      detail:
        summary.opening_expected_cents !== null &&
        summary.opening_expected_cents !== summary.opening_float_cents
          ? `el turno anterior había dejado ${money(summary.opening_expected_cents)}`
          : null,
      tone:
        summary.opening_expected_cents !== null &&
        summary.opening_expected_cents !== summary.opening_float_cents
          ? 'warn'
          : undefined,
    },
    { label: 'Cobros en efectivo', value: `+ ${money(summary.cash_sales_cents)}`, detail: null },
  ]
  for (const movement of summary.movements) {
    if (movement.voided_at) continue
    const out = movement.kind === 'out'
    drawerLines.push({
      label: `${out ? 'Se sacó' : 'Entró'}: ${movement.reason}`,
      value: `${out ? '−' : '+'} ${money(movement.amount_cents)}`,
      detail: `${movement.by_name} ${clockAt(movement.at, timeZone)}`,
    })
  }
  const expectedAtClose = closed
    ? (shift.expected_cash_cents ?? summary.expected_cash_cents)
    : summary.expected_cash_cents
  drawerLines.push({
    label: closed ? 'Tenía que haber' : 'Tiene que haber',
    value: money(expectedAtClose),
    detail: null,
    tone: 'strong',
  })
  let difference: ShiftReport['difference'] = null
  if (closed && shift.counted_cash_cents !== null) {
    const counted = shift.counted_cash_cents
    const gap = shift.difference_cents ?? counted - expectedAtClose
    difference = differenceWords(gap, 'past')
    const leave = shift.leave_float_cents ?? 0
    drawerLines.push(
      { label: 'Se contó', value: money(counted), detail: null },
      {
        label: difference.word,
        value: difference.kind === 'exact' ? null : money(Math.abs(gap)),
        detail: difference.kind === 'exact' ? 'lo contado coincide' : null,
        tone: difference.kind === 'exact' ? 'good' : difference.kind === 'short' ? 'bad' : 'warn',
      },
      { label: 'Quedó de cambio', value: money(leave), detail: 'para el turno que sigue' },
      { label: 'Se retiró', value: money(Math.max(0, counted - leave)), detail: null },
    )
  }
  const drawerFoot = join(
    [
      summary.cash_tips_cents > 0
        ? `Las propinas en efectivo (${money(summary.cash_tips_cents)}) van aparte: no cuentan en el cajón.`
        : null,
      closed && input.liveAfter && input.liveAfter.expected_cash_cents !== expectedAtClose
        ? `Después del cierre se corrigió algún cobro: con eso tenía que haber ${money(input.liveAfter.expected_cash_cents)}.`
        : null,
    ],
    ' ',
  )

  // ── Para mirar ──
  const watch: ReportLine[] = []
  for (const group of groupCorrections(summary.corrections)) {
    const head = group[0]
    if (!head) continue
    const changes = [...group]
      .sort((a, b) => CORRECTION_ORDER[a.field] - CORRECTION_ORDER[b.field])
      .map(correctionChange)
      .join(' · ')
    watch.push({
      label: `Corrección · ${table(head.table_label)}`,
      value: money(head.amount_cents),
      detail: join([
        changes,
        `${head.by_name} ${clockAt(head.at, timeZone)}`,
        group.some((correction) => correction.after_close) ? 'con el turno cerrado' : null,
        quote(group.find((correction) => correction.note)?.note),
      ]),
    })
  }
  for (const discount of summary.discounts) {
    watch.push({
      label: `Descuento ${discountLabel(discount.kind, discount.value)} · ${table(discount.table_label)}`,
      value: money(discount.amount_cents),
      detail: join([
        quote(discount.reason),
        discount.approved_by_name && discount.approved_by_name !== discount.by_name
          ? `pidió ${discount.by_name}, OK de ${discount.approved_by_name}`
          : discount.by_name,
      ]),
    })
  }
  for (const item of summary.item_voids) {
    watch.push({
      label: `Baja · ${item.quantity} × ${item.name} · ${table(item.table_label)}`,
      value: money(item.amount_cents),
      detail: join([
        quote(item.reason),
        item.by_name,
        item.started ? 'cocina ya lo había empezado' : null,
      ]),
      tone: item.started ? 'warn' : undefined,
    })
  }
  for (const voided of summary.payment_voids) {
    watch.push({
      label: `Cobro anulado · ${table(voided.table_label)}`,
      value: money(voided.amount_cents),
      detail: join([METHOD_LABEL[voided.method], quote(voided.reason), voided.by_name]),
    })
  }
  for (const movement of summary.movements) {
    if (!movement.voided_at) continue
    watch.push({
      label: `${movement.kind === 'out' ? 'Retiro' : 'Ingreso'} anulado: ${movement.reason}`,
      value: money(movement.amount_cents),
      detail: join([quote(movement.void_reason), movement.voided_by_name]),
    })
  }

  const sections: ReportSection[] = [
    {
      key: 'in',
      title: 'Entró a la caja',
      lines: inLines,
      foot:
        summary.payments_count === 0
          ? 'Ningún cobro en este turno.'
          : extras
            ? `Incluye ${extras}.`
            : null,
    },
  ]
  if (tableLines.length > 0) {
    sections.push({ key: 'tables', title: 'Las mesas', lines: tableLines, foot: null })
  }
  sections.push({ key: 'drawer', title: 'El cajón', lines: drawerLines, foot: drawerFoot })
  sections.push({
    key: 'watch',
    title: 'Para mirar',
    lines: watch,
    foot: watch.length === 0 ? 'Nada: sin correcciones, descuentos, bajas ni anulaciones.' : null,
  })

  return {
    headline,
    hero: { cents: heroCents, sentence },
    meta,
    closed,
    difference,
    sections,
    note: shift.closing_note?.trim() || null,
  }
}

/**
 * El resumen como texto, para copiar o mandar por WhatsApp. Sin adornos: se tiene que leer igual
 * de bien pegado en un mail. Con `bold`, el titular y los títulos van entre asteriscos (WhatsApp
 * los pone en negrita).
 */
export function shiftShareText(report: ShiftReport, options: { bold?: boolean } = {}): string {
  const strong = (text: string) => (options.bold ? `*${text}*` : text)
  const out: string[] = [strong(report.headline), report.meta]
  for (const section of report.sections) {
    out.push('', strong(section.title))
    for (const line of section.lines) {
      const value = line.value ? `: ${line.value}` : ''
      const detail = line.detail ? ` (${line.detail})` : ''
      out.push(`· ${line.label}${value}${detail}`)
    }
    if (section.foot) out.push(section.foot)
  }
  if (report.note) out.push('', `Nota de quien cerró: «${report.note}»`)
  return out.join('\n')
}
