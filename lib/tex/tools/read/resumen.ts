import 'server-only'

import { loadHome } from '@/app/(manager)/[tenantSlug]/administracion/_resumen/home-data'
import {
  type HeroPayroll,
  heroAccounts,
  heroNumbers,
  type ParaHoyRow,
  paraHoyRows,
} from '@/app/(manager)/[tenantSlug]/administracion/_resumen/para-hoy'
import {
  type ReceivableTranches,
  receivableTranches,
  walletBoxes,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  fixedDueRows,
  type HomeRecurringRow,
  heroState,
  ivaStrip,
  noticeAttention,
  payablesTranches,
  type RecurringPayments,
} from '@/lib/accounting/home'
import { payrollTotals } from '@/lib/accounting/payroll'
import { buildProjection, type Projection } from '@/lib/accounting/projection'
import {
  type DailyCloseCalendar,
  getDailyCloseCalendar,
  listRecurringExpenses,
} from '@/lib/accounting/queries/documents'
import { listParties } from '@/lib/accounting/queries/parties'
import { getPayrollReport } from '@/lib/accounting/queries/payroll'
import { getSalesProjection } from '@/lib/accounting/queries/projection'
import { listRecurringPayments } from '@/lib/accounting/queries/recurring'
import { type AccountingSettings, getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  type AccSummary,
  getSummary,
  type SummaryAttentionItem,
  type SummaryAttentionKind,
} from '@/lib/accounting/queries/summary'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import { monthOf, monthRange, serviceDayInCordoba } from '@/lib/dates'
import { capped, dayText, defineTool, money, noInput } from '../types'
import { compact, moneyIf, plain } from './common'
import { monthFigures } from './ventas'

/** Los gastos fijos que se listan en «lo que toca». */
const FIXED_MAX = 15

// ─── Lo puro: el panorama ────────────────────────────────────────────────────

export type ResumenFacts = {
  today: string
  canWrite: boolean
  summary: AccSummary
  settings: AccountingSettings | null
  /** `null`: no se pudo leer. Lo que no se pudo leer se dice «—», nunca `$ 0`. */
  projection: Projection | null
  recurring: readonly HomeRecurringRow[] | null
  payments: RecurringPayments | null
  payroll: HeroPayroll | null
  /** Los tramos de Por cobrar; `null`: no se pudo leer y quedan los de la base. */
  receivables: ReceivableTranches | null
}

/**
 * El panorama: lo mismo que el panel del Resumen, más lo que te deben. Todas las cuentas son las de
 * `lib/accounting/home.ts` y `_resumen/para-hoy.ts`, así Tex y la pantalla nunca dicen otra cosa.
 */
export function resumenData(facts: ResumenFacts) {
  const { summary, settings, today } = facts
  const openingPending = settings?.openingStatus === 'pending'
  const hero = heroState(summary, settings, { canWrite: facts.canWrite })
  const { accounts, more } = heroAccounts(summary, '')
  const numbers = heroNumbers({
    base: '',
    today,
    summary,
    openingPending,
    recurring: facts.recurring,
    payments: facts.payments,
    payroll: facts.payroll,
    projection: facts.projection,
  })
  const fixed = numbers.find((number) => number.key === 'fixed')
  const debts = payablesTranches(summary.payables, { openingPending })
  const trancheOf = (key: 'overdue' | 'week' | 'later') =>
    debts?.tranches.find((tranche) => tranche.key === key)?.cents ?? 0
  const iva = ivaStrip(summary.ivaMonth, {
    registered: settings ? settings.ivaCondition === 'responsable_inscripto' : true,
  })
  const { receivables } = facts
  return compact({
    plata_hoy: hero.kind === 'normal' ? money(hero.cents) : null,
    plata_en_palabras:
      hero.kind === 'normal' ? plain(hero.sentence) : `${hero.title}. ${hero.sentence}`,
    en_descubierto: hero.kind === 'normal' && hero.overdrawn ? true : null,
    cuentas: accounts.map((account) => `${account.name}: ${plain(account.text)}`),
    otras_cuentas: more || null,
    le_debes: debts
      ? debts.unknown
        ? `${debts.title}. ${debts.sentence}`
        : compact({
            total: money(debts.totalCents),
            vencido: money(trancheOf('overdue')),
            vence_esta_semana: money(trancheOf('week')),
            mas_adelante: money(trancheOf('later')),
            con_algo_vencido: debts.partiesRed || null,
            nota: debts.note,
          })
      : 'No se pudo calcular.',
    te_deben: receivables
      ? compact({
          total: money(receivables.totalCents),
          atrasado: money(receivables.lateCents),
          llega_esta_semana: moneyIf(receivables.weekCents),
          mas_adelante: moneyIf(receivables.laterCents),
          en_billetera_falta_contar: moneyIf(receivables.walletCents),
        })
      : summary.receivables
        ? { total: money(summary.receivables.totalCents) }
        : 'No se pudo calcular.',
    falta_de_fijos_y_sueldos: fixed
      ? compact({
          falta: fixed.cents === null ? null : money(fixed.cents),
          nota: fixed.hint ? plain(fixed.hint) : null,
        })
      : null,
    ventas_del_mes: facts.projection
      ? monthFigures(facts.projection, monthOf(today))
      : 'No se pudieron leer.',
    compras_y_gastos_del_mes: money(summary.monthToDate.purchasesAndExpensesCents),
    iva_del_mes: plain('note' in iva ? `${iva.sentence}. ${iva.note}` : iva.sentence),
  })
}

// ─── Lo puro: lo que toca ────────────────────────────────────────────────────

/** A qué pantalla lleva cada renglón de «Para hoy», para que Tex la abra con `ir_a`. */
function screenOfRow(row: ParaHoyRow): string | null {
  switch (row.key) {
    case 'close':
      return 'ventas.cierre'
    case 'plan':
      return 'compras.semana'
    case 'overdue':
      return row.action?.kind === 'sheet' && row.action.sheet === 'gasto'
        ? 'gastos.fijos'
        : 'compras.proveedores'
    case 'integration':
      return row.retry ? null : 'importar'
    case 'setup':
      return 'puesta_en_marcha'
  }
}

export function paraHoyRow(row: ParaHoyRow) {
  const params = row.action?.kind === 'sheet' ? row.action.params : null
  return compact({
    que: plain(row.title),
    detalle: row.detail ? plain(row.detail) : null,
    vencido: row.late ? true : null,
    pantalla: screenOfRow(row),
    participe_id: params?.proveedor,
    gasto_fijo_id: params?.['gasto-fijo'],
  })
}

const ATTENTION_WORDS: Readonly<Record<SummaryAttentionKind, string>> = {
  payable_overdue: 'Pago vencido',
  payable_due_week: 'Vence esta semana',
  recurring_due: 'Gasto fijo por cargar',
  missing_daily_close: 'Faltan cierres',
  receivable_overdue: 'Cobro atrasado',
  treasury_unchecked: 'Caja sin contar',
  month_ready: 'Mes listo para cerrar',
  opening_unassigned: 'Patrimonio inicial sin asignar',
  vat_pending_documentation: 'IVA a documentar',
  sas_cuit_missing: 'Falta el CUIT',
  other: 'Aviso',
}

export function attentionRow(item: SummaryAttentionItem) {
  return compact({
    que: ATTENTION_WORDS[item.kind],
    texto: item.label ? plain(item.label) : null,
    importe: item.amountCents === null ? null : money(item.amountCents),
    fecha: dayText(item.date),
    dias: item.days,
    cuantos: item.count,
    participe_id: item.partyId,
    id: item.refId,
  })
}

export function fixedDueRow(row: HomeRecurringRow) {
  return compact({
    id: row.id,
    nombre: row.name,
    monto: row.amountCents === null ? 'Sin monto' : money(row.amountCents),
    vence: dayText(row.nextDueDate),
    dias: row.daysToDue,
    vencido: row.daysToDue < 0 ? true : null,
  })
}

export function missingCloses(calendar: DailyCloseCalendar) {
  const dates = calendar.days.filter((day) => day.status === 'missing').map((day) => day.date)
  return compact({
    faltan: dates.length,
    dias: dates.map(dayText),
    el_mas_viejo_que_falta: dayText(calendar.firstMissingDate),
  })
}

/**
 * Lo que toca hacer: los renglones de «Para hoy» (hasta cinco, los mismos de la pantalla) y el
 * detalle para seguir: qué cierres faltan, qué vence y a quién, y los avisos de la base. Lo que no se
 * pudo leer se dice: «no hay nada» y «no se pudo mirar» no son lo mismo.
 */
export function pendientesData(input: {
  rows: readonly ParaHoyRow[]
  summary: AccSummary | null
  recurring: readonly HomeRecurringRow[] | null
  calendar: DailyCloseCalendar | null
}) {
  const { summary, recurring, calendar } = input
  const attention = summary?.attention ?? []
  // Cada cosa en un solo lado: los gastos fijos y los cierres tienen su propia lista.
  const payables = attention.filter(
    (item) => item.kind === 'payable_overdue' || item.kind === 'payable_due_week',
  )
  const notices = noticeAttention(attention).filter(
    (item) => item.kind !== 'recurring_due' && item.kind !== 'missing_daily_close',
  )
  const fixed = capped(fixedDueRows(recurring).map(fixedDueRow), FIXED_MAX)
  const unread = [
    summary === null ? 'el resumen' : null,
    recurring === null ? 'los gastos fijos' : null,
    calendar === null ? 'los cierres' : null,
  ].filter((part) => part !== null)
  return compact({
    para_hoy: input.rows.map(paraHoyRow),
    cierres: calendar ? missingCloses(calendar) : null,
    vencimientos: payables.map(attentionRow),
    gastos_fijos: fixed.filas,
    gastos_fijos_hay_mas: fixed.hay_mas || null,
    avisos: notices.map(attentionRow),
    no_pude_leer: unread.length > 0 ? unread : null,
  })
}

// ─── Las herramientas ────────────────────────────────────────────────────────

/** El panorama: Resumen y lo que toca hacer. */
export const resumenReadTools = [
  defineTool({
    name: 'ver_resumen',
    description:
      'El panorama de hoy: la plata, lo que se debe (vencido y por vencer), lo que te deben, lo que falta de fijos y sueldos, y las ventas del mes contra el objetivo. Usala para «cómo estamos».',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando el resumen',
    done: () => 'Miré el resumen',
    run: async (_input, ctx) => {
      const { tenantId, today } = ctx
      const serviceDay = serviceDayInCordoba()
      const [summary, settings, projection, recurring, payments, payroll, receivables, treasuries] =
        await Promise.all([
          // Sin esto no hay panorama: que tire. Lo demás se dice que no se pudo leer.
          getSummary(tenantId, { asOf: today }),
          settleQuery(getAccountingSettings(tenantId)),
          settleQuery(
            getSalesProjection(tenantId, monthRange(today)).then((rows) =>
              buildProjection(rows, { serviceDay }),
            ),
          ),
          settleQuery(listRecurringExpenses(tenantId, { includeInactive: true, today })),
          settleQuery(listRecurringPayments(tenantId)),
          settleQuery(
            getPayrollReport(tenantId, monthOf(today)).then((report) =>
              payrollTotals(report.employees),
            ),
          ),
          settleQuery(listParties(tenantId, { group: 'receivables', asOf: today })),
          settleQuery(listTreasuryAccounts(tenantId)),
        ])
      return {
        kind: 'data',
        data: resumenData({
          today,
          canWrite: ctx.access.write,
          summary,
          settings: settings.ok ? settings.data : null,
          projection: projection.ok ? projection.data : null,
          recurring: recurring.ok ? recurring.data : null,
          payments: payments.ok ? payments.data : null,
          payroll: payroll.ok ? payroll.data : null,
          receivables:
            receivables.ok && treasuries.ok
              ? receivableTranches(
                  receivables.data.rows,
                  new Set(walletBoxes(receivables.data.rows, treasuries.data).keys()),
                )
              : null,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_pendientes',
    description:
      'Lo que toca hacer hoy: el cierre que falta, el plan de la semana, lo vencido, lo de ARCA, los gastos fijos por vencer y los avisos. Usala para «qué tengo que hacer» o «qué me falta».',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando lo que toca',
    done: () => 'Miré lo que toca',
    run: async (_input, ctx) => {
      const serviceDay = serviceDayInCordoba()
      // Las mismas lecturas y el mismo armado que el bloque «Para hoy».
      const home = loadHome({
        tenantId: ctx.tenantId,
        tenantSlug: ctx.slug,
        today: ctx.today,
        serviceDay,
        canWrite: ctx.access.write,
      })
      const [agenda, summary, settings, recurring, weekPlan, onboarding, integration, calendar] =
        await Promise.all([
          home.agenda,
          home.summary,
          home.settings,
          home.recurring,
          home.weekPlan,
          home.onboarding,
          home.integration,
          settleQuery(getDailyCloseCalendar(ctx.tenantId, monthOf(serviceDay), { serviceDay })),
        ])
      const summaryData = summary.ok ? summary.data : null
      const recurringData = recurring.ok ? recurring.data : null
      const rows = paraHoyRows({
        items: agenda.today,
        setup: agenda.setup,
        setupCountKnown: summary.ok || (onboarding.ok && onboarding.data !== null),
        summary: summaryData,
        recurring: recurringData,
        weekPlan: weekPlan.ok ? weekPlan.data : null,
        // Quien solo lee no recibe estos avisos; si fallaron, se dice.
        integration: integration === null ? [] : integration.ok ? integration.data : null,
        booksStartDate: settings.ok ? (settings.data?.booksStartDate ?? null) : null,
        today: ctx.today,
        base: home.base,
      })
      return {
        kind: 'data',
        data: pendientesData({
          rows,
          summary: summaryData,
          recurring: recurringData,
          calendar: calendar.ok ? calendar.data : null,
        }),
      }
    },
  }),
]
