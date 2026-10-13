/**
 * Los textos del Resumen de Administración (H.4), puros: la fecha del
 * encabezado y cada renglón de aviso con su acción (los de «Lo que tenés que
 * pagar» y los de «Avisos»). La base manda el SUJETO de cada aviso (`label`:
 * «Coca-Cola · Factura A 0003-00001234», «Mercado Pago», «Octubre 2026») y los
 * datos; la frase se arma acá, en un solo lugar.
 *
 * Lo que el Resumen calcula y dibuja (la plata por caja, «Hoy te toca», los
 * gastos fijos del mes) está en `lib/accounting/home.ts`. Quedan acá, con sus
 * tests, el desglose en una línea de la plata y la cuenta simple de gastos
 * fijos por pagar: ya no los usa la pantalla.
 */

import type { AccountingAction, ActionParams } from '@/components/administracion/acciones/types'
import type { RecurringExpenseRow } from '@/lib/accounting/queries/documents'
import type { IntegrationAttentionItem } from '@/lib/accounting/queries/integrations'
import type {
  AccSummary,
  SummaryAttentionItem,
  SummaryTreasury,
} from '@/lib/accounting/queries/summary'
import {
  capitalizeFirst,
  daysBetween,
  formatDate,
  formatDayMonth,
  monthName,
  weekdayName,
} from '@/lib/dates'
import { formatCentsShort } from '@/lib/money'

/** «Miércoles 7 de octubre». */
export function headerDateLine(today: string): string {
  const weekday = weekdayName(today)
  const day = Number(today.slice(8, 10))
  const month = monthName(Number(today.slice(5, 7)))
  if (!weekday || !month || !Number.isFinite(day)) return ''
  return `${capitalizeFirst(weekday)} ${day} de ${month}`
}

/** «jueves 08/10». */
function weekdayAndDay(iso: string): string {
  const weekday = weekdayName(iso)
  return weekday ? `${weekday} ${formatDayMonth(iso)}` : formatDayMonth(iso)
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'día' : 'días'}`
}

// ─── Plata disponible ────────────────────────────────────────────────────────

/** Una caja en una línea: «Caja $ 150.000», «Mercado Pago $ 1.390.000 (+ $ 420.000 en camino)». */
export function treasuryShortLine(t: SummaryTreasury): string {
  const balance =
    t.balanceCents < 0
      ? `en descubierto ${formatCentsShort(-t.balanceCents)}`
      : formatCentsShort(t.balanceCents)
  const pending =
    t.pendingWalletCents > 0 ? ` (+ ${formatCentsShort(t.pendingWalletCents)} en camino)` : ''
  return `${t.name} ${balance}${pending}`
}

/**
 * Los tramos del desglose debajo de «Plata disponible» (hasta 3 cajas; el
 * resto, «y N más»). Cada tramo se muestra entero: la línea corta entre cajas,
 * nunca entre el nombre y su saldo.
 */
export function availableBreakdownParts(
  summary: Pick<AccSummary, 'treasuries' | 'cardDebtCents'>,
): string[] {
  const assets = summary.treasuries.filter((t) => t.kind !== 'credit_card')
  const shown = assets.slice(0, 3).map(treasuryShortLine)
  const rest = assets.length - shown.length
  const parts = [...shown]
  if (rest > 0) parts.push(`y ${rest} más`)
  if (summary.cardDebtCents > 0) {
    parts.push(`Tarjeta de la empresa: deuda ${formatCentsShort(summary.cardDebtCents)}`)
  }
  return parts
}

/** El desglose debajo de «Plata disponible», en una línea de texto. */
export function availableBreakdown(
  summary: Pick<AccSummary, 'treasuries' | 'cardDebtCents'>,
): string {
  return availableBreakdownParts(summary).join(' · ')
}

/**
 * El saldo de una caja leído en su sentido: en la tarjeta de la empresa el
 * resumen trae Debe − Haber (la deuda es negativa) y se muestra como deuda.
 */
export function treasuryNormalBalance(t: Pick<SummaryTreasury, 'kind' | 'balanceCents'>): number {
  return t.kind === 'credit_card' ? -t.balanceCents : t.balanceCents
}

// ─── Te falta de gasto fijo ──────────────────────────────────────────────────

export type FixedExpensesPending = {
  /** Σ de los pendientes que tienen monto. */
  totalCents: number
  /** Pendientes con monto conocido (los que suman). */
  withAmount: number
  /** Pendientes de monto variable: no entran en la suma y se cuentan aparte. */
  withoutAmount: number
}

/**
 * Lo que falta pagar de gastos fijos (pedido de los socios, 12/10/2026): los
 * activos que vencen este mes o ya vencieron y todavía no se cargaron ni se
 * saltearon (`monthStatus: 'pending'`). Los de monto variable no suman.
 */
export function pendingFixedExpenses(
  rows: ReadonlyArray<Pick<RecurringExpenseRow, 'active' | 'monthStatus' | 'amountCents'>>,
): FixedExpensesPending {
  const out: FixedExpensesPending = { totalCents: 0, withAmount: 0, withoutAmount: 0 }
  for (const row of rows) {
    if (!row.active || row.monthStatus !== 'pending') continue
    if (row.amountCents === null) out.withoutAmount += 1
    else {
      out.withAmount += 1
      out.totalCents += row.amountCents
    }
  }
  return out
}

/** «5 por pagar y 4 sin monto», debajo de «Te falta de gasto fijo». */
export function fixedExpensesHint(pending: FixedExpensesPending): string {
  const { withAmount, withoutAmount } = pending
  if (withAmount === 0 && withoutAmount === 0) return 'Nada por pagar este mes.'
  if (withAmount === 0) {
    return withoutAmount === 1 ? '1 por pagar, sin monto' : `${withoutAmount} por pagar, sin monto`
  }
  return withoutAmount === 0
    ? `${withAmount} por pagar`
    : `${withAmount} por pagar y ${withoutAmount} sin monto`
}

// ─── Avisos ──────────────────────────────────────────────────────────────────

export type AttentionAction =
  | { type: 'sheet'; label: string; action: AccountingAction; params: ActionParams }
  | { type: 'link'; label: string; href: string }
  | { type: 'skip'; label: string; recurringId: string; dueDate: string }
  /** Vuelve a pedir la página (un bloque que no cargó). */
  | { type: 'retry'; label: string }

export type AttentionTone = 'danger' | 'warning' | 'info'

export type AttentionView = {
  key: string
  text: string
  /** El importe a la derecha (`null`: ya está en el texto o no hay). */
  amountCents: number | null
  /** «aprox.» para un gasto fijo (el monto es estimado). */
  amountPrefix: string | null
  tone: AttentionTone
  actions: AttentionAction[]
}

const FALLBACK_SUBJECT: Readonly<Record<string, string>> = {
  payable_overdue: 'Una factura',
  payable_due_week: 'Una factura',
  recurring_due: 'Un gasto fijo',
  receivable_overdue: 'Un cobro',
  treasury_unchecked: 'una caja',
  month_ready: 'El mes',
  vat_pending_documentation: 'Una plataforma',
}

function subjectOf(item: SummaryAttentionItem): string {
  const label = item.label.trim()
  return label || FALLBACK_SUBJECT[item.kind] || 'Algo'
}

/** Días de atraso: los manda la base; si no, se cuentan desde la fecha. */
function lateDays(item: SummaryAttentionItem, today: string): number | null {
  if (item.days !== null) return Math.abs(item.days)
  return item.date ? Math.max(0, daysBetween(item.date, today)) : null
}

/**
 * Un renglón de aviso: el texto, el importe y la acción que corresponde (la
 * hoja de acción rápida sobre el Resumen, o la pantalla). Los de pagar van en
 * «Lo que tenés que pagar»; el resto, en «Avisos».
 * `base` = `/{slug}/administracion`.
 */
export function attentionView(
  item: SummaryAttentionItem,
  today: string,
  base: string,
  index: number,
): AttentionView {
  const key = `${item.kind}:${item.refId ?? ''}:${item.date ?? ''}:${index}`
  const subject = subjectOf(item)
  const view = (
    text: string,
    tone: AttentionTone,
    actions: AttentionAction[],
    amountCents: number | null = item.amountCents,
    amountPrefix: string | null = null,
  ): AttentionView => ({ key, text, amountCents, amountPrefix, tone, actions })
  const pay: AttentionAction[] = item.partyId
    ? [{ type: 'sheet', label: 'Pagar', action: 'pagar', params: { proveedor: item.partyId } }]
    : [{ type: 'link', label: 'Ver proveedores', href: `${base}/compras?tab=proveedores` }]

  switch (item.kind) {
    case 'payable_overdue': {
      const late = lateDays(item, today)
      const when =
        late === null
          ? 'vencida'
          : late === 0
            ? 'vence hoy'
            : late === 1
              ? 'venció ayer'
              : `venció hace ${days(late)}`
      return view(`${subject} · ${when}`, 'danger', pay)
    }
    case 'payable_due_week': {
      const when = !item.date
        ? 'vence esta semana'
        : item.date === today
          ? 'vence hoy'
          : `vence el ${weekdayAndDay(item.date)}`
      return view(`${subject} · ${when}`, 'warning', pay)
    }
    case 'recurring_due': {
      const when = item.date ? `vence el ${formatDayMonth(item.date)}` : 'vence pronto'
      const actions: AttentionAction[] = []
      if (item.refId) {
        actions.push({
          type: 'link',
          label: 'Cargar una compra que debo',
          href: `${base}/compras/nueva?gasto-fijo=${encodeURIComponent(item.refId)}`,
        })
        if (item.date) {
          actions.push({
            type: 'skip',
            label: 'Este mes no se paga',
            recurringId: item.refId,
            dueDate: item.date,
          })
        }
      }
      return view(
        `${subject} · ${when} · todavía sin cargar`,
        'warning',
        actions,
        item.amountCents,
        'aprox.',
      )
    }
    case 'missing_daily_close': {
      const count = item.count ?? 1
      const text = !item.date
        ? subject !== 'Algo'
          ? subject
          : 'Faltan cierres del día'
        : count > 1
          ? `Faltan ${count} cierres del día (desde el ${weekdayAndDay(item.date)})`
          : `Falta el cierre del ${weekdayAndDay(item.date)}`
      const href = item.date ? `${base}/ventas/cierre?fecha=${item.date}` : `${base}/ventas/cierre`
      return view(text, 'warning', [{ type: 'link', label: 'Cargar', href }], null)
    }
    case 'receivable_overdue': {
      const late = lateDays(item, today)
      const when = late === null || late === 0 ? 'atrasado' : `atrasado ${days(late)}`
      const actions: AttentionAction[] = item.partyId
        ? [
            {
              type: 'sheet',
              label: 'Registrar cobro',
              action: 'cobrar',
              params: { cliente: item.partyId },
            },
          ]
        : []
      return view(`${subject} · ${when}`, 'warning', actions)
    }
    case 'treasury_unchecked': {
      const last = item.date
        ? `La contaste por última vez el ${formatDayMonth(item.date)}`
        : 'Todavía no la contaste'
      const actions: AttentionAction[] = [
        {
          type: 'sheet',
          label: 'Contar la caja',
          action: 'ajustar',
          params: item.refId ? { caja: item.refId } : {},
        },
      ]
      return view(`¿Coincide ${subject}? ${last}.`, 'info', actions, null)
    }
    case 'month_ready': {
      const warnings = item.count ?? 0
      const extra = warnings > 0 ? ` (${warnings} ${warnings === 1 ? 'aviso' : 'avisos'})` : ''
      return view(
        `${subject} está listo para cerrar${extra}`,
        'info',
        [{ type: 'link', label: 'Revisar y cerrar', href: `${base}/libros/cierres` }],
        null,
      )
    }
    case 'opening_unassigned': {
      const amount = item.amountCents === null ? null : Math.abs(item.amountCents)
      const text =
        amount === null
          ? 'Hay patrimonio inicial sin asignar: lo revisa la contadora'
          : `Hay ${formatCentsShort(amount)} de patrimonio inicial sin asignar: lo revisa la contadora`
      return view(text, 'info', [], null)
    }
    case 'vat_pending_documentation': {
      const actions: AttentionAction[] = item.partyId
        ? [{ type: 'link', label: 'Ver', href: `${base}/ventas/clientes/${item.partyId}` }]
        : []
      return view(`${subject} · IVA de comisiones sin su factura`, 'info', actions)
    }
    case 'sas_cuit_missing':
      return view(
        'Falta el CUIT de la SAS: los libros de IVA lo necesitan.',
        'warning',
        [{ type: 'link', label: 'Completar', href: `${base}/ajustes?tab=sas` }],
        null,
      )
    default:
      return view(item.label.trim() || 'Hay algo para revisar.', 'info', [])
  }
}

// ─── Integraciones: la segunda fuente de «Avisos» ────────────────────────────

const TONE_RANK: Readonly<Record<AttentionTone, number>> = { danger: 0, warning: 1, info: 2 }

/**
 * Un aviso de ARCA, Mercado Pago, el banco o Mis Comprobantes
 * (`getIntegrationAttention`, diseño §5.2.4) como renglón de «Avisos», con su
 * botón a la pantalla que lo resuelve. `href` viene relativo a
 * `/<bar>/administracion`.
 */
export function integrationAttentionView(
  item: IntegrationAttentionItem,
  base: string,
  index: number,
): AttentionView {
  return {
    key: `integracion:${item.kind}:${index}`,
    text: item.label,
    amountCents: null,
    amountPrefix: null,
    tone: item.tone,
    actions: [{ type: 'link', label: item.actionLabel, href: `${base}${item.href}` }],
  }
}

/** La fila de cuando no se pudo revisar ARCA ni los importadores: no se calla, se reintenta. */
export function integrationFailedView(): AttentionView {
  return {
    key: 'integracion:error',
    text: 'No pudimos revisar ARCA ni los importadores.',
    amountCents: null,
    amountPrefix: null,
    tone: 'info',
    actions: [{ type: 'retry', label: 'Reintentar' }],
  }
}

/**
 * Suma los avisos de las integraciones a los del Resumen sin tocar el orden
 * que trae la base (`acc_report_summary` ya los ordena por urgencia): cada
 * aviso nuevo entra antes de la primera fila menos urgente que él (rojo,
 * después amarillo, después azul) y, a igual urgencia, después de las del
 * Resumen. Los avisos nuevos mantienen su orden entre sí.
 */
export function mergeAttentionViews(
  summary: readonly AttentionView[],
  extra: readonly AttentionView[],
): AttentionView[] {
  // `sort` es estable: a igual urgencia queda el orden en que llegaron.
  const queue = [...extra].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])
  const out: AttentionView[] = []
  let next = 0
  for (const view of summary) {
    for (let pending = queue[next]; pending; pending = queue[next]) {
      if (TONE_RANK[pending.tone] >= TONE_RANK[view.tone]) break
      out.push(pending)
      next++
    }
    out.push(view)
  }
  out.push(...queue.slice(next))
  return out
}

// ─── Estado de los libros (contadora) ────────────────────────────────────────

/** «Septiembre» (de `'2026-09-01'`). */
export function monthWord(month: string): string {
  const name = monthName(Number(month.slice(5, 7)))
  return name ? capitalizeFirst(name) : 'El mes'
}

/** «Último mes cerrado: septiembre (el 05/10/2026 por Franco)». */
export function lastClosedLine(books: AccSummary['books']): string {
  if (!books.lastClosedMonth) return 'Todavía no se cerró ningún mes.'
  const name = monthName(Number(books.lastClosedMonth.slice(5, 7)))
  const when = books.closedAt ? ` el ${formatDate(books.closedAt)}` : ''
  const who = books.closedBy ? ` por ${books.closedBy}` : ''
  return `Último mes cerrado: ${name} ${books.lastClosedMonth.slice(0, 4)}${when || who ? ` (${`${when}${who}`.trim()})` : ''}.`
}

/** «Octubre: abierto, 2 avisos». */
export function openMonthLine(books: AccSummary['books']): string | null {
  if (!books.openMonth) return null
  const warnings = books.openWarnings ?? 0
  const extra = warnings > 0 ? `, ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}` : ''
  return `${monthWord(books.openMonth)}: abierto${extra}.`
}
