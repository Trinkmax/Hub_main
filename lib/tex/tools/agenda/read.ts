import 'server-only'

import { z } from 'zod'
import { getAppUrl } from '@/lib/app-url'
import { resolveCommissionPeriod } from '@/lib/commissions/period'
import { monthRange } from '@/lib/dates'
import type { DepositBasis } from '@/lib/salon/deposits'
import {
  boardClockMinutes,
  isAfterMidnightOf,
  normalizeText,
  nowHHMMInCordoba,
  serviceDayInCordoba,
} from '@/lib/salon/operativo'
import {
  getBonusRule,
  getDepositsByDay,
  getManagerForUser,
  getRangeReservationTotals,
  listCakeOptions,
  listCommissionBreakdown,
  listCommissionSummary,
  listManagers,
  listMyCommissionEntries,
  listRateTiers,
  listSalonReservations,
  listScheduledEventsForDateRange,
  listScheduledTemplates,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import {
  getDayOverview,
  getDaySegmentsSnapshot,
  getMonthSegments,
} from '@/lib/salon/segment-queries'
import {
  computeDaySegments,
  type DaySegments,
  eventDisplayName,
  eventLoadsById,
} from '@/lib/salon/segments'
import { RESERVATION_STAFF_ROLES } from '@/lib/tenant/roles'
import type { TenantRole } from '@/lib/tenant/types'
import { nowLocalIn } from '@/lib/ticketing/dates'
import { getTicketingSettings, listRecentOrders } from '@/lib/ticketing/queries'
import { cappedBySize, periodFields, texPeriod } from '../read/common'
import { capped, defineTool, type TexToolContext, type TexToolResult } from '../types'
import { readCartelera } from './_entradas'
import {
  agendaRange,
  BOARD_WORDS,
  type BoardWord,
  boardData,
  cakeRow,
  commissionEntriesData,
  commissionSummaryData,
  dawnNote,
  dayCapacityData,
  dayReservationsData,
  depositsData,
  entradasData,
  eventCard,
  eventRow,
  filterDayRows,
  managerRow,
  monthsOfRange,
  ORDER_FILTERS,
  ordersData,
  rangeReservationsData,
  rateTierData,
  reservationCard,
  searchRow,
  seatCounts,
  templateRow,
} from './_read-data'
import { findEvent, findManagerIn, findReservation, searchReservations } from './_resolve'
import {
  KIND_OF_WORD,
  KIND_WORDS,
  OWNER_ONLY,
  realDay,
  SEGMENT_OF_WORD,
  SERVICE_WORDS,
  STATUS_FILTER_WORDS,
  STATUS_OF_WORD,
  ZONE_FILTER_WORDS,
  ZONE_OF_FILTER_WORD,
} from './_words'

/**
 * Lo que Tex puede mirar de Reservas, Calendario y Entradas. Todo con la sesión de la persona y con las
 * mismas consultas de las pantallas; los permisos son los de cada página.
 */

/** `/mis-numeros`: cada gestor ve lo suyo (`cl_manager_self_select`). */
const MY_NUMBERS_ROLES: readonly TenantRole[] = ['owner', 'host']

/** El cálculo por servicio es de a meses. Los 60 días que se miran por defecto pueden tocar cuatro. */
const MAX_SEGMENT_MONTHS = 4
const RANGE_ROWS = 60
const ORDERS_READ = 60

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

/** Los días y los eventos de un rango, con la misma cuenta que el calendario. */
async function segmentsOfRange(
  ctx: TexToolContext,
  from: string,
  to: string,
): Promise<{ days: DaySegments[]; events: ScheduledEventWithTemplate[] } | null> {
  const months = monthsOfRange(from, to)
  if (months.length > MAX_SEGMENT_MONTHS) return null
  const perMonth = await Promise.all(
    months.map(async (ym) => {
      const range = monthRange(ym)
      const events = await listScheduledEventsForDateRange({ tenantId: ctx.tenantId, ...range })
      const month = await getMonthSegments({ tenantId: ctx.tenantId, ym, events })
      return { events, days: Object.values(month.days) }
    }),
  )
  return {
    days: perMonth
      .flatMap((m) => m.days)
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    events: perMonth
      .flatMap((m) => m.events)
      .filter((e) => e.event_date >= from && e.event_date <= to),
  }
}

const COMMISSION_PERIOD_HINT = 'Sin período, el mes en curso.'

export const agendaReadTools = [
  defineTool({
    name: 'ver_reservas',
    description:
      'Las reservas de un día o de un rango, con las personas por servicio: «cuántos vienen hoy», «qué hay el viernes», «reservas de esta semana», «cumples del sábado». Por defecto, hoy.',
    input: z.object({
      fecha: realDay('Un día, yyyy-MM-dd. Sin nada, hoy.').optional(),
      ...periodFields,
      servicio: z.enum(SERVICE_WORDS).optional(),
      estado: z
        .enum(STATUS_FILTER_WORDS)
        .optional()
        .describe('Sin esto, todas menos las canceladas.'),
      planta: z.enum(ZONE_FILTER_WORDS).optional(),
      tipo: z.enum(KIND_WORDS).optional(),
      gestor: z.string().trim().min(1).optional().describe('Quién la tomó: nombre o id.'),
      buscar: z.string().trim().min(2).max(60).optional().describe('Parte del nombre.'),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando las reservas',
    done: () => 'Miré las reservas',
    run: async (input, ctx) => {
      let gestorId: string | undefined
      if (input.gestor) {
        const managers = await listManagers({ tenantId: ctx.tenantId, onlyActive: false })
        const found = findManagerIn(managers, input.gestor)
        if (!found.ok) return fail(found.message)
        gestorId = found.value.id
      }

      const isRange = Boolean(input.mes || input.desde || input.hasta)
      if (!isRange) {
        const date = input.fecha ?? ctx.today
        const overview = await getDayOverview({ tenantId: ctx.tenantId, date })
        const day = computeDaySegments({
          date,
          reservations: overview.reservations,
          events: overview.events,
          caps: overview.caps,
        })
        return {
          kind: 'data',
          data: dayReservationsData({
            date,
            rows: overview.reservations,
            filtered: filterDayRows(overview.reservations, { ...input, gestorId }),
            day,
            note: dawnNote(serviceDayInCordoba(), ctx.today, Boolean(input.fecha)),
          }),
        }
      }

      const period = agendaRange(input, ctx.today)
      if (!period.ok) return fail(period.message)
      const [totals, list, segments] = await Promise.all([
        getRangeReservationTotals({ tenantId: ctx.tenantId, from: period.from, to: period.to }),
        listSalonReservations({
          tenantId: ctx.tenantId,
          dateFrom: period.from,
          dateTo: period.to,
          ...(input.estado
            ? { status: STATUS_OF_WORD[input.estado] }
            : { excludeStatus: ['cancelled'] }),
          ...(input.servicio ? { mealType: SEGMENT_OF_WORD[input.servicio] } : {}),
          ...(input.planta ? { zone: ZONE_OF_FILTER_WORD[input.planta] } : {}),
          ...(input.tipo ? { kind: KIND_OF_WORD[input.tipo] } : {}),
          ...(gestorId ? { managerId: gestorId } : {}),
          ...(input.buscar ? { q: input.buscar } : {}),
          page: 1,
          pageSize: RANGE_ROWS,
          sort: 'asc',
        }),
        segmentsOfRange(ctx, period.from, period.to),
      ])
      return {
        kind: 'data',
        data: rangeReservationsData({
          label: period.label,
          totals,
          days: segments?.days ?? null,
          rows: list.rows,
          total: list.total,
        }),
      }
    },
  }),

  defineTool({
    name: 'buscar_reserva',
    description:
      'Busca una reserva por el nombre, por los últimos números del teléfono o por el Instagram, y da su id. Usala para «la reserva de García», «¿para cuándo reservó Ana?». Trae también las canceladas.',
    input: z.object({
      buscar: z
        .string()
        .trim()
        .min(2)
        .max(60)
        .describe('Parte del nombre, del teléfono o del Instagram.'),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Buscando la reserva',
    done: () => 'Busqué la reserva',
    run: async (input, ctx) => {
      const rows = await searchReservations(ctx, input.buscar)
      return { kind: 'data', data: capped(rows.map(searchRow), 20) }
    },
  }),

  defineTool({
    name: 'ver_reserva',
    description:
      'Una reserva entera: personas, estado, mesa, seña, torta, avisos, nota, quién la tomó y a qué hora llegó. Los datos de contacto se ven en su ficha.',
    input: z.object({
      reserva: z.string().trim().min(2).describe('Nombre o id.'),
      de_la_fecha: realDay('Su fecha, si hay más de una con ese nombre.').optional(),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando la reserva',
    done: () => 'Miré la reserva',
    run: async (input, ctx) => {
      const found = await findReservation(ctx, input.reserva, input.de_la_fecha, {
        orCancelled: true,
      })
      if (!found.ok) return fail(found.message)
      return { kind: 'data', data: reservationCard(found.value) }
    },
  }),

  defineTool({
    name: 'ver_cupo',
    description:
      'El cupo de un día: cuánta gente hay y cuántos lugares quedan en el almuerzo, la merienda y la cena, con lo que aparta cada evento. Usala para «¿hay lugar para 8 el sábado?», «¿cómo viene la cena?». `libres` es lo que queda para reservas normales.',
    input: z.object({ fecha: realDay('Un día, yyyy-MM-dd. Sin nada, hoy.').optional() }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando el cupo',
    done: () => 'Miré el cupo',
    run: async (input, ctx) => {
      const date = input.fecha ?? ctx.today
      const snapshot = await getDaySegmentsSnapshot({ tenantId: ctx.tenantId, date })
      const note = dawnNote(serviceDayInCordoba(), ctx.today, Boolean(input.fecha))
      return {
        kind: 'data',
        data: {
          ...dayCapacityData(computeDaySegments(snapshot)),
          ...(note ? { nota: note } : {}),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_tablero',
    description:
      'El tablero de la noche: quién falta llegar, quién está adentro y quién está atrasado, con sus mesas. Usala para «¿quién falta?», «¿cuántos llegaron?», «¿en qué mesa está García?». Hasta las 5 de la mañana sigue en la noche anterior.',
    input: z.object({
      ver: z
        .enum(Object.keys(BOARD_WORDS) as [BoardWord, ...BoardWord[]])
        .optional()
        .describe('Sin esto, por_llegar.'),
      buscar: z.string().trim().min(1).max(60).optional().describe('Nombre, mesa o teléfono.'),
      fecha: realDay('Otro día, yyyy-MM-dd. Sin nada, la noche de hoy.').optional(),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando el tablero',
    done: () => 'Miré el tablero',
    run: async (input, ctx) => {
      const now = new Date()
      const serviceDay = serviceDayInCordoba(now)
      const date = input.fecha ?? serviceDay
      const overview = await getDayOverview({ tenantId: ctx.tenantId, date })
      return {
        kind: 'data',
        data: boardData({
          date,
          serviceDay,
          rows: overview.reservations,
          day: computeDaySegments({
            date,
            reservations: overview.reservations,
            events: overview.events,
            caps: overview.caps,
          }),
          clock: boardClockMinutes(date, now),
          nowText: nowHHMMInCordoba(now),
          afterMidnight: isAfterMidnightOf(date, now),
          ver: input.ver ?? 'por_llegar',
          buscar: input.buscar,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_eventos',
    description:
      'Los eventos del calendario, con su cupo, cuánta gente reservó y cuántos lugares quedan. Usala para «¿qué eventos vienen?», «¿cómo va el evento del sábado?». Sin período, los próximos 60 días.',
    input: z.object({
      ...periodFields,
      formato: z.string().trim().min(1).optional().describe('Solo los de un formato: su nombre.'),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando los eventos',
    done: () => 'Miré los eventos',
    run: async (input, ctx) => {
      const period = agendaRange(input, ctx.today)
      if (!period.ok) return fail(period.message)
      const segments = await segmentsOfRange(ctx, period.from, period.to)
      if (!segments) return fail('Pedí hasta 4 meses de eventos de una vez.')
      const days = Object.fromEntries(segments.days.map((d) => [d.date, d]))
      const loads = eventLoadsById(days)
      const key = input.formato ? normalizeText(input.formato) : null
      const shown = key
        ? segments.events.filter(
            (e) =>
              normalizeText(eventDisplayName(e)).includes(key) ||
              normalizeText(e.template?.name ?? '').includes(key),
          )
        : segments.events
      const sorted = [...shown].sort((a, b) =>
        `${a.event_date}${a.starts_at_local}` < `${b.event_date}${b.starts_at_local}` ? -1 : 1,
      )
      const { filas, hay_mas } = cappedBySize(
        sorted.map((e) => eventRow(e, loads[e.id])),
        40,
      )
      return {
        kind: 'data',
        data: { periodo: period.label, cuantos: shown.length, filas, hay_mas },
      }
    },
  }),

  defineTool({
    name: 'ver_evento',
    description:
      'Un evento del calendario con sus reservas: «¿quiénes vienen al evento del sábado?», «¿cuántos lugares le quedan?». Da su cupo, sus puntos por asistir y si es grupo privado.',
    input: z.object({
      evento: z.string().trim().min(1).describe('Nombre o id.'),
      de_la_fecha: realDay('Su fecha, si hay más de uno con ese nombre.').optional(),
    }),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando el evento',
    done: () => 'Miré el evento',
    run: async (input, ctx) => {
      const found = await findEvent(ctx, input.evento, input.de_la_fecha)
      if (!found.ok) return fail(found.message)
      const { rows } = await listSalonReservations({
        tenantId: ctx.tenantId,
        scheduledEventId: found.value.id,
        pageSize: 200,
      })
      return { kind: 'data', data: eventCard(found.value, rows) }
    },
  }),

  defineTool({
    name: 'ver_formatos',
    description:
      'Los formatos de evento: el catálogo que se programa en el calendario, con su cupo y su servicio. Usala antes de programar un evento si no sabés cómo se llama el formato.',
    input: z.object({}),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando los formatos',
    done: () => 'Miré los formatos',
    run: async (_input, ctx) => {
      const templates = await listScheduledTemplates({ tenantId: ctx.tenantId, onlyActive: false })
      return { kind: 'data', data: capped(templates.map(templateRow), 60) }
    },
  }),

  defineTool({
    name: 'ver_tortas',
    description:
      'El menú de tortas de cumpleaños: qué opciones hay, con su masa y sus rellenos. Usala para «¿qué tortas tienen?» o antes de anotar una torta en una reserva.',
    input: z.object({}),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando las tortas',
    done: () => 'Miré las tortas',
    run: async (_input, ctx) => {
      const cakes = await listCakeOptions({ tenantId: ctx.tenantId, onlyActive: true })
      return { kind: 'data', data: capped(cakes.map(cakeRow), 30) }
    },
  }),

  defineTool({
    name: 'ver_gestores',
    description:
      'Quiénes pueden figurar como gestor de una reserva y quiénes cobran comisión. Usala si no sabés a nombre de quién poner una reserva.',
    input: z.object({}),
    need: { roles: RESERVATION_STAFF_ROLES },
    doing: () => 'Mirando los gestores',
    done: () => 'Miré los gestores',
    run: async (_input, ctx) => {
      const [managers, self] = await Promise.all([
        listManagers({ tenantId: ctx.tenantId, onlyActive: true }),
        getManagerForUser({ tenantId: ctx.tenantId, userId: ctx.userId }),
      ])
      return {
        kind: 'data',
        data: capped(
          managers.map((m) => managerRow(m, self?.id ?? null)),
          40,
        ),
      }
    },
  }),

  defineTool({
    name: 'ver_comisiones',
    description: `Las comisiones de cada gestor en un período: cuánto lleva, cuánto se pagó y cuánto falta. Con gestor, el detalle por reserva. Usala para «¿cuánto le debo de comisiones a Ana?». ${COMMISSION_PERIOD_HINT}`,
    input: z.object({
      ...periodFields,
      gestor: z.string().trim().min(1).optional().describe('Para ver el detalle: nombre o id.'),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las comisiones',
    done: () => 'Miré las comisiones',
    run: async (input, ctx) => {
      const period = resolveCommissionPeriod(
        { from: input.desde, to: input.hasta, month: input.mes },
        ctx.today,
      )
      if (!input.gestor) {
        const summary = await listCommissionSummary({
          tenantId: ctx.tenantId,
          from: period.from,
          to: period.to,
        })
        return {
          kind: 'data',
          data: commissionSummaryData(period, summary.rows, summary.truncated),
        }
      }
      const managers = await listManagers({ tenantId: ctx.tenantId, onlyActive: false })
      const found = findManagerIn(managers, input.gestor)
      if (!found.ok) return fail(found.message)
      const { entries, truncated } = await listCommissionBreakdown({
        tenantId: ctx.tenantId,
        managerId: found.value.id,
        from: period.from,
        to: period.to,
      })
      return {
        kind: 'data',
        data: commissionEntriesData({
          period,
          manager: found.value.display_name,
          entries,
          truncated,
          today: ctx.today,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_mis_numeros',
    description: `Lo que va ganando quien habla con las reservas que gestiona: a cobrar, cobrado y el detalle. Usala para «¿cuánto llevo?», «mis comisiones», «¿me pagaron?». ${COMMISSION_PERIOD_HINT}`,
    input: z.object(periodFields),
    need: { roles: MY_NUMBERS_ROLES },
    doing: () => 'Mirando tus números',
    done: () => 'Miré tus números',
    run: async (input, ctx) => {
      const period = resolveCommissionPeriod(
        { from: input.desde, to: input.hasta, month: input.mes },
        ctx.today,
      )
      const manager = await getManagerForUser({ tenantId: ctx.tenantId, userId: ctx.userId })
      if (!manager) {
        return {
          kind: 'data',
          data: {
            vinculada: false,
            nota: 'Esta cuenta no está vinculada a un gestor. Lo hace un dueño en Configuración › Comisiones › Gestores.',
          },
        }
      }
      const { entries, truncated } = await listMyCommissionEntries({
        tenantId: ctx.tenantId,
        managerId: manager.id,
        from: period.from,
        to: period.to,
      })
      return {
        kind: 'data',
        data: commissionEntriesData({
          period,
          manager: manager.display_name,
          entries,
          truncated,
          today: ctx.today,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_tarifas_comision',
    description:
      'Cuánto se paga de comisión por persona, según el servicio y el tamaño de la mesa, y el bonus de evento lleno. Usala para «¿cuánto se paga por una cena de 10?».',
    input: z.object({}),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las tarifas',
    done: () => 'Miré las tarifas',
    run: async (_input, ctx) => {
      const [tiers, bonus] = await Promise.all([
        listRateTiers({ tenantId: ctx.tenantId }),
        getBonusRule({ tenantId: ctx.tenantId }),
      ])
      return { kind: 'data', data: rateTierData(tiers, bonus) }
    },
  }),

  defineTool({
    name: 'ver_senas',
    description:
      'La plata de las señas de un período, día por día: «¿cuánto entró de señas este mes?», «¿cuánta seña tengo para el sábado?». Por día de la reserva o por día de carga. Las canceladas y las que no vinieron suman, y van aparte.',
    input: z.object({
      ...periodFields,
      criterio: z
        .enum(['reserva', 'carga'])
        .optional()
        .describe(
          'reserva: el día que viene la gente. carga: el día que entró. Sin esto, reserva.',
        ),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las señas',
    done: () => 'Miré las señas',
    run: async (input, ctx) => {
      const period = texPeriod(input, ctx.today)
      if (!period.ok) return fail(period.message)
      const basis: DepositBasis = input.criterio === 'carga' ? 'created' : 'reservation'
      const report = await getDepositsByDay({
        tenantId: ctx.tenantId,
        basis,
        from: period.from,
        to: period.to,
      })
      return { kind: 'data', data: depositsData(report, period.label, basis) }
    },
  }),

  defineTool({
    name: 'ver_entradas',
    description:
      'Las películas de la venta online y sus funciones: cupo, cuántos lugares quedan y cuántos se vendieron online. Usala para «¿cuántas entradas quedan para el 12?», «¿qué funciones están agotadas?», y para el link de la cartelera.',
    input: z.object({
      pelicula: z.string().trim().min(1).optional().describe('Solo una: parte del título.'),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las entradas',
    done: () => 'Miré las entradas',
    run: async (input, ctx) => {
      const [cartelera, settings, appUrl] = await Promise.all([
        readCartelera(ctx),
        getTicketingSettings(ctx.tenantId),
        getAppUrl(),
      ])
      const now = new Date()
      return {
        kind: 'data',
        data: entradasData({
          experiences: cartelera.experiences,
          events: cartelera.events,
          counts: seatCounts(cartelera.reservations, cartelera.orders, now),
          nowLocal: nowLocalIn(undefined, now),
          canSell: Boolean(settings.mp_connected_at),
          publicUrl: `${appUrl}/entradas/${ctx.slug}`,
          wanted: input.pelicula,
        }),
      }
    },
  }),

  defineTool({
    name: 'ver_ventas_entradas',
    description:
      'Las últimas ventas online de entradas: quién compró, para qué función, cuánto pagó y si ya entró. Usala para «¿quién compró para el sábado?», «¿hay algún pago rechazado?», «¿cuánto vendimos?».',
    input: z.object({
      estado: z.enum(ORDER_FILTERS).optional(),
      pelicula: z.string().trim().min(1).optional().describe('Parte del título.'),
    }),
    need: { roles: OWNER_ONLY },
    doing: () => 'Mirando las ventas',
    done: () => 'Miré las ventas',
    run: async (input, ctx) => {
      const orders = await listRecentOrders(ctx.tenantId, ORDERS_READ)
      return {
        kind: 'data',
        data: ordersData({
          orders,
          now: new Date(),
          estado: input.estado,
          pelicula: input.pelicula,
          read: ORDERS_READ,
        }),
      }
    },
  }),
]
