import 'server-only'

import { z } from 'zod'
import {
  type FlowView,
  flowView,
  PROJECTION_SENTENCE,
  type ProjectionView,
  projectionView,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/flow-view'
import {
  walletHero,
  walletTotals,
} from '@/app/(manager)/[tenantSlug]/administracion/cajas/_lib/wallet-view'
import type { HeroState } from '@/lib/accounting/home'
import { TREASURY_KIND_LABELS } from '@/lib/accounting/queries/labels'
import { getAccountingSettings } from '@/lib/accounting/queries/settings'
import { settleQuery } from '@/lib/accounting/queries/shared'
import {
  getCashFlow,
  getCashProjection,
  getTreasuryMovements,
  listTreasuryBalances,
  type TreasuryBalanceRow,
  type TreasuryMovementRow,
  type TreasuryMovementsPage,
} from '@/lib/accounting/queries/treasury'
import { resolveTreasury } from '../../resolve'
import { dayText, defineTool, money, noInput } from '../types'
import { compact, moneyIf, newestFirst, periodFields, plain, shortText, texPeriod } from './common'

/** Lo que se muestra de una lista de movimientos. */
const MOVEMENTS_MAX = 40
/** Lo que se lee de una: lo más que da la base en una página. */
const MOVEMENTS_READ = 500

// ─── Lo puro ─────────────────────────────────────────────────────────────────

/**
 * Las cuentas con lo que tienen, y el total que dice Caja y el Resumen: sin la tarjeta de la empresa,
 * que es una deuda. Si el cero no es un dato (faltan los saldos iniciales), se dice y no hay total.
 */
export function cajasData(rows: readonly TreasuryBalanceRow[], hero: HeroState) {
  const totals = walletTotals(rows)
  return compact({
    total: hero.kind === 'normal' ? money(totals.availableCents) : null,
    aviso: hero.kind === 'unknown' ? `${hero.title}. ${hero.sentence}` : null,
    en_camino: moneyIf(totals.pendingWalletCents),
    deuda_de_tarjetas: moneyIf(totals.cardDebtCents),
    cajas: rows
      .filter((row) => row.active)
      .map((row) =>
        compact({
          id: row.treasuryId,
          nombre: row.name,
          tipo: TREASURY_KIND_LABELS[row.kind] ?? row.kind,
          ...(row.kind === 'credit_card'
            ? { debe: money(Math.max(0, -row.balanceCents)) }
            : { saldo: money(row.balanceCents) }),
          descubierto: row.kind !== 'credit_card' && row.balanceCents < 0 ? true : null,
          en_camino: moneyIf(row.pendingWalletCents),
          contada_el: dayText(row.lastCheckedOn),
        }),
      ),
  })
}

/** El detalle sin repetir el comprobante: con «Gasto», «Gasto · Hielo» queda en «Hielo». */
export function movementDetail(description: string | null, label: string | null): string | null {
  if (!description || description === label) return null
  const prefix = label ? `${label} · ` : ''
  return prefix && description.startsWith(prefix)
    ? description.slice(prefix.length) || null
    : description
}

export function movementRow(row: TreasuryMovementRow) {
  return compact({
    fecha: dayText(row.entryDate),
    comprobante: row.documentLabel,
    comprobante_id: row.documentId,
    detalle: shortText(movementDetail(row.description, row.documentLabel), 60),
    contrapartida: shortText(row.counterpart, 40),
    entro: moneyIf(row.inCents),
    salio: moneyIf(row.outCents),
    saldo: money(row.balanceCents),
  })
}

/**
 * Los movimientos de una caja, del más nuevo al más viejo, con lo que entró y salió en TODO el período
 * (sale de sumas y saldos, no de sumar lo que se ve).
 */
export function movementsData(page: TreasuryMovementsPage, label: string) {
  const lines = page.rows.filter((row) => row.rowKind === 'line')
  const { filas, hay_mas } = newestFirst(lines.map(movementRow), MOVEMENTS_MAX)
  return compact({
    caja: { id: page.treasury.id, nombre: page.treasury.name },
    periodo: label,
    saldo_al_empezar: money(page.openingCents),
    entro: money(page.inCents),
    salio: money(page.outCents),
    saldo_al_terminar: money(page.closingCents),
    cuantos: page.totalRows,
    filas,
    hay_mas,
    nota: page.nextCursor
      ? `Son más de ${MOVEMENTS_READ} movimientos: pedí un período más corto para ver los últimos.`
      : null,
  })
}

/** «Entró y salió» por categoría, con los mismos números y palabras que la pantalla. */
export function flowData(view: FlowView, label: string) {
  const byCategory = (rows: FlowView['in']['rows']) =>
    rows.map((row) => ({ categoria: row.label, monto: money(row.cents) }))
  return compact({
    periodo: label,
    entro: money(view.inCents),
    salio: money(view.outCents),
    diferencia: money(view.inCents - view.outCents),
    oracion: plain(view.sentence),
    de_donde_vino: byCategory(view.in.rows),
    en_que_se_fue: byCategory(view.out.rows),
    // Con un solo mes, los totales ya son los de ese mes.
    por_mes:
      view.months.length > 1
        ? view.months.map((month) => ({
            mes: month.label,
            entro: money(month.inCents),
            salio: money(month.outCents),
          }))
        : null,
  })
}

/**
 * Si alcanza la plata. Nunca afirma que va a faltar: la proyección no sabe cuánto se va a vender, y
 * por eso va la aclaración de la pantalla.
 */
export function projectionData(view: ProjectionView, weeks: number, availableCents: number) {
  if (view.kind === 'unknown') return { alcanza: null, oracion: view.title }
  if (view.kind === 'nothing') {
    return {
      alcanza: true,
      plata_hoy: money(availableCents),
      oracion:
        weeks === 1
          ? 'No hay nada que venza esta semana.'
          : `No hay nada que venza en las próximas ${weeks} semanas.`,
    }
  }
  return {
    alcanza: !view.short,
    plata_hoy: money(availableCents),
    oracion: plain(view.title),
    aclaracion: PROJECTION_SENTENCE,
    semanas: view.weeks.map((week) =>
      compact({
        semana: week.note ? `${week.label}, ${week.note}` : week.label,
        entra: money(week.inCents),
        sale: money(week.outCents),
        queda: money(week.balanceCents),
        faltaria: week.short ? true : null,
      }),
    ),
  }
}

// ─── Las herramientas ────────────────────────────────────────────────────────

export const cajasReadTools = [
  defineTool({
    name: 'ver_cajas',
    description:
      'Cuánta plata hay hoy en cada caja, banco y billetera, con su id. Usala para «cuánto hay», «qué saldo tiene» o antes de mover plata.',
    input: noInput,
    need: 'read',
    doing: () => 'Mirando las cajas',
    done: () => 'Miré las cajas',
    run: async (_input, ctx) => {
      const [rows, settings] = await Promise.all([
        listTreasuryBalances(ctx.tenantId, { asOf: ctx.today }),
        settleQuery(getAccountingSettings(ctx.tenantId)),
      ])
      const hero = walletHero(rows, settings.ok ? settings.data : null, {
        canWrite: ctx.access.write,
      })
      return { kind: 'data', data: cajasData(rows, hero) }
    },
  }),

  defineTool({
    name: 'ver_movimientos_caja',
    description:
      'Lo que entró y salió de una caja, banco o billetera en un período, con su saldo y los comprobantes, de lo más nuevo a lo más viejo. Usala para «qué pasó en la caja», «por qué bajó» o para ubicar un movimiento.',
    input: z.object({
      caja: z.string().min(1).describe('El nombre de la caja o su id.'),
      ...periodFields,
    }),
    need: 'read',
    doing: () => 'Mirando los movimientos de la caja',
    done: () => 'Miré los movimientos de la caja',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const treasury = await resolveTreasury(ctx, input.caja)
      if (!treasury.ok) return { kind: 'error', message: treasury.message }
      const page = await getTreasuryMovements(ctx.tenantId, {
        treasuryId: treasury.value.id,
        from: period.from,
        to: period.to,
        limit: MOVEMENTS_READ,
      })
      if (!page) return { kind: 'error', message: 'Esa caja ya no está.' }
      return { kind: 'data', data: movementsData(page, period.label) }
    },
  }),

  defineTool({
    name: 'ver_flujo',
    description:
      'Cuánto entró y cuánto salió de todas las cajas en un período, por categoría (ventas, proveedores, sueldos, impuestos…). Usala para «en qué se fue la plata». Pasar plata de una caja a otra no cuenta.',
    input: z.object(periodFields),
    need: 'read',
    doing: () => 'Mirando lo que entró y salió',
    done: () => 'Miré lo que entró y salió',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return { kind: 'error', message: period.message }
      const rows = await getCashFlow(ctx.tenantId, { from: period.from, to: period.to })
      return { kind: 'data', data: flowData(flowView(rows), period.label) }
    },
  }),

  defineTool({
    name: 'ver_proximas_semanas',
    description:
      'Si alcanza la plata para lo que vence en las próximas semanas, y cuánto quedaría cada una. Es una estimación: no cuenta lo que se va a vender.',
    input: z.object({
      semanas: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe('Cuántas semanas mirar; si no se dice, 4.'),
    }),
    need: 'read',
    doing: () => 'Mirando las próximas semanas',
    done: () => 'Miré las próximas semanas',
    run: async (input, ctx) => {
      const weeks = input.semanas ?? 4
      const [rows, balances, settings] = await Promise.all([
        getCashProjection(ctx.tenantId, { asOf: ctx.today, weeks }),
        listTreasuryBalances(ctx.tenantId, { asOf: ctx.today }),
        settleQuery(getAccountingSettings(ctx.tenantId)),
      ])
      const hero = walletHero(balances, settings.ok ? settings.data : null, {
        canWrite: ctx.access.write,
      })
      const availableCents = walletTotals(balances).availableCents
      const view = projectionView(rows, availableCents, {
        today: ctx.today,
        known: hero.kind === 'normal',
      })
      return { kind: 'data', data: projectionData(view, weeks, availableCents) }
    },
  }),
]
