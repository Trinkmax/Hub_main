import 'server-only'

import { z } from 'zod'
import { SALES_METHOD_KIND_LABELS } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/labels'
import {
  receivableArrival,
  receivableTranches,
  walletBoxes,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/incoming'
import {
  netTotals,
  netVisibleRows,
} from '@/app/(manager)/[tenantSlug]/administracion/ventas/_lib/net-view'
import { DAY_TYPE_LABELS, type DayType, dayTypes } from '@/lib/accounting/day-type'
import { monthPace, monthSentence, monthTitle } from '@/lib/accounting/home'
import {
  buildProjection,
  cashDiffText,
  complianceText,
  type Projection,
  type ProjectionDay,
} from '@/lib/accounting/projection'
import { getNetByMethod, type NetByMethodRow } from '@/lib/accounting/queries/books'
import { type DailyCloseCalendar, getDailyCloseCalendar } from '@/lib/accounting/queries/documents'
import { CHANNEL_LABELS, PARTY_KIND_LABELS, vatRateLabel } from '@/lib/accounting/queries/labels'
import { listParties, type PartyList } from '@/lib/accounting/queries/parties'
import { getSalesProjection } from '@/lib/accounting/queries/projection'
import { listSalesMethods, type SalesMethodRow } from '@/lib/accounting/queries/settings'
import { listTreasuryAccounts } from '@/lib/accounting/queries/treasury'
import {
  formatMonthLabel,
  monthName,
  monthRange,
  serviceDayInCordoba,
  WEEKDAY_NAMES_SHORT,
  weekdayOf,
} from '@/lib/dates'
import { capped, dayText, defineTool, money, monthField, noInput } from '../types'
import { compact, moneyIf, periodFields, plain, shortText, texMonth, texPeriod } from './common'

/** Lo que se muestra de una lista. */
const LIST_MAX = 40
/** Días de más adelante que entran en el resumen de la proyección. */
const NEXT_DAYS = 3

// ─── Lo puro: la proyección ──────────────────────────────────────────────────

/** Los números del mes: los mismos de Ventas › Proyección y del Resumen. Un mes sin cierres no vendió cero. */
export function monthFigures(projection: Pick<Projection, 'summary' | 'days'>, month: string) {
  const { summary, days } = projection
  const pace = monthPace(projection)
  // Con cierre o, en un bar con punto de venta, con lo que cobró.
  const anySales = days.some((day) => day.hasSales)
  const fromPos = days.filter((day) => day.source === 'pos').length
  return compact({
    titulo: plain(monthTitle(summary, monthName(Number(month.slice(5, 7))))),
    oracion: plain(monthSentence(projection)),
    vendido: anySales ? money(summary.soldCents) : null,
    objetivo: summary.hasTargets ? money(summary.monthTargetCents) : null,
    cumplimiento: summary.monthPercent === null ? null : `${summary.monthPercent} %`,
    objetivo_a_hoy: summary.pace ? money(summary.targetToDateCents) : null,
    contra_objetivo_a_hoy: summary.pace ? plain(complianceText(summary.pace) ?? '') : null,
    falta: moneyIf(summary.remainingCents),
    por_arriba: moneyIf(summary.surplusCents),
    por_dia_para_llegar: moneyIf(pace.perDayCents),
    dias_que_quedan: pace.daysLeft,
    // Si alguno tomó la venta del punto de venta, ya no son todos «con cierre».
    ...(pace.fromPos ? { dias_con_ventas: pace.loadedDays } : { dias_con_cierre: pace.loadedDays }),
    promedio_por_dia: moneyIf(pace.averageCents),
    dias_tomados_del_punto_de_venta: fromPos || null,
    nota_punto_de_venta:
      fromPos > 0
        ? 'Esos días todavía no tienen cierre: el número es lo que cobró el punto de venta. A los libros va el cierre.'
        : null,
  })
}

export function projectionDayRow(day: ProjectionDay, type: DayType) {
  return compact({
    fecha: dayText(day.day),
    dia: WEEKDAY_NAMES_SHORT[weekdayOf(day.day)],
    tipo: type === 'none' ? null : DAY_TYPE_LABELS[type],
    objetivo: day.targetCents === null ? null : money(day.targetCents),
    // Un día sin cargar no es un cero.
    vendido: day.hasSales ? money(day.netCents) : null,
    // Sin cierre, lo vendido es lo que cobró el punto de venta: provisorio hasta que se cargue.
    origen:
      day.source === 'pos'
        ? day.moment === 'today'
          ? 'punto de venta, la noche sigue abierta'
          : 'punto de venta, sin cierre todavía'
        : null,
    cumplimiento: plain(complianceText(day.compliance) ?? '') || null,
    nota: shortText(day.note, 60),
    caja: day.cash.kind === 'compared' ? plain(cashDiffText(day.cash.diffCents)) : null,
  })
}

/**
 * Los días que importan cuando se pide un resumen, sin repetir: hoy, los próximos con objetivo, los
 * que ya pasaron sin cierre, el que más vendió, y el mejor y el peor contra su objetivo. Cada uno dice
 * por qué está.
 */
export function daysThatMatter(days: readonly ProjectionDay[]): Array<{
  day: ProjectionDay
  por_que: string
}> {
  const picked = new Map<string, { day: ProjectionDay; por_que: string }>()
  const pick = (day: ProjectionDay | undefined, why: string) => {
    if (!day) return
    const known = picked.get(day.day)
    if (known) known.por_que = `${known.por_que} y ${why}`
    else picked.set(day.day, { day, por_que: why })
  }
  pick(
    days.find((day) => day.moment === 'today'),
    'hoy',
  )
  // Los días terminados con ventas: con cierre, o los que tomaron lo del punto de venta.
  const closed = days.filter(
    (day) => day.hasSales && !(day.moment === 'today' && day.source === 'pos'),
  )
  const bySales = [...closed].sort((a, b) => b.netCents - a.netCents)
  pick(bySales[0], 'el que más vendió')
  const measured = closed.filter((day) => day.compliance.kind === 'value')
  const percent = (day: ProjectionDay) =>
    day.compliance.kind === 'value' ? day.compliance.percent : 0
  const byCompliance = [...measured].sort((a, b) => percent(a) - percent(b))
  pick(byCompliance[0], 'el peor contra su objetivo')
  if (byCompliance.length > 1) pick(byCompliance.at(-1), 'el mejor contra su objetivo')
  for (const day of days) if (day.compliance.kind === 'no_close') pick(day, 'sin cierre')
  for (const day of days
    .filter((d) => d.moment === 'future' && d.targetCents !== null)
    .slice(0, NEXT_DAYS)) {
    pick(day, 'lo que viene')
  }
  return [...picked.values()].sort((a, b) => a.day.day.localeCompare(b.day.day))
}

/** El mes entero, o solo los días que importan: los totales son los de `buildProjection`, siempre. */
export function projectionData(projection: Projection, month: string, summaryOnly: boolean) {
  const types = dayTypes(projection.days)
  const typeOf = (day: ProjectionDay) => types[day.day] ?? 'none'
  const { totals, cash } = projection
  return compact({
    mes: formatMonthLabel(month),
    ...monthFigures(projection, month),
    totales: compact({
      venta_bar: money(totals.barCents),
      venta_delivery: moneyIf(totals.deliveryCents),
      comision_delivery: moneyIf(totals.deliveryCommissionCents),
      comision_posnet: moneyIf(totals.posnetCommissionCents),
      venta_real: money(totals.realCents),
      venta_neta: money(totals.netCents),
      eventos: moneyIf(totals.eventsCents),
    }),
    caja:
      cash.comparedDays + cash.missingCountDays + cash.missingCloseDays > 0
        ? compact({
            dias_comparados: cash.comparedDays,
            diferencia: cash.comparedDays > 0 ? plain(cashDiffText(cash.diffCents)) : null,
            dias_sin_contar_lo_que_entro: cash.missingCountDays || null,
            dias_con_lo_que_entro_y_sin_cierre: cash.missingCloseDays || null,
          })
        : null,
    dias: summaryOnly
      ? daysThatMatter(projection.days).map(({ day, por_que }) => ({
          ...projectionDayRow(day, typeOf(day)),
          por_que,
        }))
      : projection.days.map((day) => projectionDayRow(day, typeOf(day))),
  })
}

// ─── Lo puro: los cierres ────────────────────────────────────────────────────

/** Los días del mes que faltan cargar, y el más viejo que falta (puede ser del mes pasado). */
export function missingClosesData(calendar: DailyCloseCalendar) {
  const missing = calendar.days.filter((day) => day.status === 'missing')
  return compact({
    mes: formatMonthLabel(calendar.month),
    faltan: calendar.missingDays,
    dias: missing.map((day) => ({
      fecha: dayText(day.date),
      dia: WEEKDAY_NAMES_SHORT[weekdayOf(day.date)],
    })),
    el_mas_viejo_que_falta: dayText(calendar.firstMissingDate),
    cargados: calendar.loadedDays,
    vendido: money(calendar.soldCents),
    hoy_se_carga_despues: calendar.days.some((day) => day.status === 'pending') ? true : null,
    libros_desde: dayText(calendar.booksStartDate),
  })
}

// ─── Lo puro: lo que te deben ────────────────────────────────────────────────

type WalletTreasury = Parameters<typeof walletBoxes>[1][number]

/**
 * Tarjetas, plataformas y clientes. Lo de Mercado Pago nunca está «atrasado»: ya está en la app y lo
 * que falta es contarla. Mismos tramos y las mismas palabras que Ventas › Por cobrar.
 */
export function receivablesData(
  list: PartyList,
  treasuries: readonly WalletTreasury[],
  today: string,
) {
  const wallets = walletBoxes(list.rows, treasuries)
  const tranches = receivableTranches(list.rows, new Set(wallets.keys()))
  const open = list.rows.filter((row) => row.debtCents > 0 || row.creditCents > 0)
  const { filas, hay_mas } = capped(
    open.map((row) => {
      const arrival = receivableArrival(row, { today, wallet: wallets.has(row.partyId) })
      return compact({
        id: row.partyId,
        nombre: row.tradeName ?? row.partyName,
        tipo: PARTY_KIND_LABELS[row.partyKind] ?? row.partyKind,
        te_debe: money(row.debtCents),
        a_favor: moneyIf(row.creditCents),
        llega: arrival.kind === 'none' ? null : arrival.text,
        detalle: arrival.note ? plain(arrival.note) : null,
      })
    }),
    LIST_MAX,
  )
  return compact({
    total: money(tranches.totalCents),
    atrasado: money(tranches.lateCents),
    llega_esta_semana: moneyIf(tranches.weekCents),
    mas_adelante: moneyIf(tranches.laterCents),
    en_billetera_falta_contar: moneyIf(tranches.walletCents),
    a_favor: moneyIf(list.totals.creditCents),
    cuantos: open.length,
    filas,
    hay_mas,
  })
}

// ─── Lo puro: lo que llegó y los medios ──────────────────────────────────────

export function netData(rows: readonly NetByMethodRow[], label: string) {
  const visible = netVisibleRows(rows)
  const totals = netTotals(visible)
  const { filas, hay_mas } = capped(
    visible.map((row) =>
      compact({
        medio: row.methodName,
        medio_id: row.methodId,
        canal: CHANNEL_LABELS[row.channel] ?? row.channel,
        vendido: money(row.soldCents),
        llego: money(row.creditedCents),
        comision: moneyIf(row.commissionCents + row.commissionVatCents),
        retenciones: moneyIf(row.withholdingsCents),
        otros_descuentos: moneyIf(row.otherChargesCents + row.unexplainedCents),
        descuento: row.discountBp === null ? null : vatRateLabel(row.discountBp),
        en_camino: moneyIf(row.pendingCents),
      }),
    ),
    LIST_MAX,
  )
  return {
    periodo: label,
    vendido: money(totals.soldCents),
    llego: money(totals.creditedCents),
    se_quedaron: money(totals.deductedCents),
    en_camino: money(totals.pendingCents),
    nota: 'Son cifras por separado: una liquidación puede ser de ventas de otro período.',
    filas,
    hay_mas,
  }
}

export function salesMethodRow(row: SalesMethodRow) {
  return compact({
    id: row.id,
    nombre: row.name,
    como: SALES_METHOD_KIND_LABELS[row.kind] ?? row.kind,
    canal: CHANNEL_LABELS[row.channel] ?? row.channel,
    caja: row.treasuryName,
    quien_paga: row.partyName,
    dias_para_acreditar: row.settlementDays > 0 ? row.settlementDays : null,
  })
}

// ─── Las herramientas ────────────────────────────────────────────────────────

/** La proyección, los cierres, lo que te deben y lo que llegó. */
export const ventasReadTools = [
  defineTool({
    name: 'ver_proyeccion',
    description:
      'Ventas de un mes contra el objetivo: cuánto se vendió, cuánto falta y, por día, objetivo, tipo (Flojo, Normal, Fuerte), vendido y cumplimiento. Con resumen, solo los días que importan.',
    input: z.object({
      mes: monthField('Mes yyyy-MM. Si no se dice, el actual.').optional(),
      resumen: z
        .boolean()
        .optional()
        .describe('Solo hoy, lo que viene, lo que falta cargar, el mejor y el peor día.'),
    }),
    need: 'read',
    doing: () => 'Mirando la proyección',
    done: () => 'Miré la proyección',
    run: async (input, ctx) => {
      const month = texMonth(input.mes, ctx.today)
      if (!month.ok) return { kind: 'error', message: month.message }
      const rows = await getSalesProjection(ctx.tenantId, monthRange(month.month), {
        // Como en la pantalla: en un bar con punto de venta, los días sin cierre toman lo que cobró.
        pos: ctx.role === 'owner' && ctx.features.pos === true,
      })
      const projection = buildProjection(rows, { serviceDay: serviceDayInCordoba() })
      return { kind: 'data', data: projectionData(projection, month.month, input.resumen === true) }
    },
  }),

  defineTool({
    name: 'ver_cierres_faltantes',
    description:
      'Qué cierres del día faltan cargar en un mes, y cuál es el más viejo. El día de hoy todavía no falta (se carga cuando termina el servicio).',
    input: z.object({
      mes: monthField('Mes yyyy-MM. Si no se dice, el actual.').optional(),
    }),
    need: 'read',
    doing: () => 'Mirando los cierres',
    done: () => 'Miré los cierres',
    run: async (input, ctx) => {
      const month = texMonth(input.mes, ctx.today)
      if (!month.ok) return { kind: 'error', message: month.message }
      const calendar = await getDailyCloseCalendar(ctx.tenantId, month.month, {
        serviceDay: serviceDayInCordoba(),
      })
      return { kind: 'data', data: missingClosesData(calendar) }
    },
  }),

  defineTool({
    name: 'ver_por_cobrar',
    description:
      'Lo que te deben las tarjetas, las plataformas y los clientes, y cuándo llega. Lo de una billetera no está atrasado: falta contarla.',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando lo que te deben',
    done: () => 'Miré lo que te deben',
    run: async (_input, ctx) => {
      const [list, treasuries] = await Promise.all([
        listParties(ctx.tenantId, { group: 'receivables', asOf: ctx.today }),
        listTreasuryAccounts(ctx.tenantId),
      ])
      return { kind: 'data', data: receivablesData(list, treasuries, ctx.today) }
    },
  }),

  defineTool({
    name: 'ver_lo_que_llego',
    description:
      'De cada medio de cobro en un período: cuánto se vendió, cuánto llegó, cuánto se quedaron en comisiones y retenciones y cuánto sigue en camino.',
    input: z.object(periodFields),
    need: 'read',
    doing: () => 'Mirando lo que llegó',
    done: () => 'Miré lo que llegó',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const rows = await getNetByMethod(ctx.tenantId, { from: period.from, to: period.to })
      return { kind: 'data', data: netData(rows, period.label) }
    },
  }),

  defineTool({
    name: 'ver_medios_de_cobro',
    description:
      'Los medios de cobro del bar con su id, en el orden del cierre del día, y a dónde va cada uno. Hacen falta para cargar un cierre.',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando los medios de cobro',
    done: () => 'Miré los medios de cobro',
    run: async (_input, ctx) => {
      const rows = await listSalesMethods(ctx.tenantId)
      return { kind: 'data', data: capped(rows.map(salesMethodRow), LIST_MAX) }
    },
  }),
]
