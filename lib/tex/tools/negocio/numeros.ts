import 'server-only'

import { z } from 'zod'
import { isRealIsoDay } from '@/lib/dates'
import { getReviewInsights, listReviews } from '@/lib/reviews/queries'
import { getMonthBirthdayReport } from '@/lib/salon/birthday-queries'
import {
  getDayReport,
  getMonthMarketingReport,
  getTemplateReport,
  getTodaySalonOverview,
  getZoneCapacityDefaults,
  listEventTemplateOptions,
  listRecentReservationDays,
} from '@/lib/salon/queries'
import { resolveDateRange } from '@/lib/staff-performance/date-range'
import { getStaffSummaries } from '@/lib/staff-performance/queries'
import {
  getChurnRisk,
  getCommunicationStats,
  getDailyMetrics,
  getEventsRanking,
  getHeatmap,
  getKpis,
  getTopCustomersBySpent,
} from '@/lib/stats/queries'
import { createClient } from '@/lib/supabase/server'
import type { TenantRole } from '@/lib/tenant/types'
import { texMonth } from '../read/common'
import {
  dayField,
  defineTool,
  monthField,
  noInput,
  type TexToolContext,
  type TexToolNeed,
  type TexToolResult,
} from '../types'
import { pickNamed } from './_carta-values'
import {
  birthdaysData,
  commsStats,
  customerStats,
  dayReportData,
  eventStats,
  homeData,
  monthPautaData,
  overviewStats,
  reviewsData,
  type SetupFacts,
  STAFF_PERIODS,
  staffRangeInput,
  staffStats,
  templateOptionsData,
  templateReportData,
} from './_numeros-values'

/** Las estadísticas, Cómo nos fue y las reseñas son del dueño: sus páginas piden `['owner']`. */
const OWNER_ONLY: readonly TenantRole[] = ['owner']
const OWNER: TexToolNeed = { roles: OWNER_ONLY }

/** Lo que muestra la pantalla: 60 días para comparar contra los 30 anteriores, 90 para Estadísticas. */
const HOME_DAYS = 60
const STATS_DAYS = 90
const TOP_ON_HOME = 5
const TOP_MAX = 50
const TOP_DEFAULT = 15
const CHURN_READ = 200
const EVENTS_READ = 20
const REVIEWS_DEFAULT = 15
const REVIEWS_MAX = 40

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

/**
 * Los cinco pasos de «Configurá tu bar». `getOnboardingStatus` vive adentro de la página de la portada,
 * que no se puede importar: acá va la misma lectura, con la sesión de la persona.
 */
async function setupFacts(ctx: TexToolContext): Promise<SetupFacts> {
  const supabase = await createClient()
  const [templates, scheduled, reservations, closed, caps] = await Promise.all([
    supabase
      .from('scheduled_event_templates')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .limit(1),
    supabase
      .from('scheduled_events')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .gte('event_date', ctx.today)
      .limit(1),
    supabase
      .from('salon_reservations')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .limit(1),
    supabase
      .from('salon_reservations')
      .select('id', { head: true, count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['arrived', 'seated', 'closed'])
      .limit(1),
    getZoneCapacityDefaults({ tenantId: ctx.tenantId }),
  ])
  return {
    capacitiesReady: caps.planta_alta > 0 && caps.planta_baja > 0,
    templatesReady: (templates.count ?? 0) > 0,
    eventScheduledReady: (scheduled.count ?? 0) > 0,
    firstReservationReady: (reservations.count ?? 0) > 0,
    firstClosedReady: (closed.count ?? 0) > 0,
  }
}

export const numerosTools = [
  defineTool({
    name: 'ver_inicio',
    description:
      'El Resumen del dueño, la portada del panel: hoy en el salón, clientes, visitas y facturación de los últimos 30 días contra los anteriores, los que más consumen y lo que falta configurar.',
    input: noInput,
    need: OWNER,
    doing: () => 'Mirando el resumen',
    done: () => 'Miré el resumen',
    run: async (_input, ctx) => {
      const [kpis, daily, top, today, setup] = await Promise.all([
        getKpis(ctx.tenantId),
        getDailyMetrics(ctx.tenantId, HOME_DAYS),
        getTopCustomersBySpent(ctx.tenantId, TOP_ON_HOME),
        getTodaySalonOverview({ tenantId: ctx.tenantId, date: ctx.today }),
        setupFacts(ctx),
      ])
      return { kind: 'data', data: homeData({ kpis, daily, top, today, setup }) }
    },
  }),

  defineTool({
    name: 'ver_estadisticas',
    description:
      'Las estadísticas del negocio: clientes, activos, visitas, facturación, ticket promedio y horarios fuertes; top de clientes y en riesgo de irse; eventos por asistencia; difusiones; mozos.',
    input: z.object({
      seccion: z
        .enum(['resumen', 'clientes', 'eventos', 'comunicacion', 'mozos'])
        .optional()
        .describe('Sin esto, el resumen.'),
      cantidad: z.number().int().min(1).max(TOP_MAX).optional().describe('En clientes: cuántos.'),
      periodo: z
        .enum(Object.keys(STAFF_PERIODS) as [keyof typeof STAFF_PERIODS])
        .optional()
        .describe('En mozos. Sin esto, los últimos 7 días.'),
      desde: dayField('En mozos: desde, yyyy-MM-dd.').optional(),
      hasta: dayField('En mozos: hasta, yyyy-MM-dd.').optional(),
    }),
    need: OWNER,
    doing: () => 'Mirando las estadísticas',
    done: () => 'Miré las estadísticas',
    run: async (input, ctx) => {
      switch (input.seccion ?? 'resumen') {
        case 'clientes': {
          const max = input.cantidad ?? TOP_DEFAULT
          const [top, churn] = await Promise.all([
            getTopCustomersBySpent(ctx.tenantId, max),
            getChurnRisk(ctx.tenantId, CHURN_READ),
          ])
          return { kind: 'data', data: customerStats(top, churn, max) }
        }
        case 'eventos':
          return {
            kind: 'data',
            data: eventStats(await getEventsRanking(ctx.tenantId, EVENTS_READ), ctx.today),
          }
        case 'comunicacion':
          return { kind: 'data', data: commsStats(await getCommunicationStats(ctx.tenantId)) }
        case 'mozos': {
          if ((input.desde === undefined) !== (input.hasta === undefined)) {
            return fail('Para un período a medida hacen falta las dos fechas: desde y hasta.')
          }
          if (input.desde && input.hasta) {
            if (!isRealIsoDay(input.desde) || !isRealIsoDay(input.hasta)) {
              return fail('Esa fecha no existe.')
            }
            if (input.desde > input.hasta) return fail('El «hasta» es anterior al «desde».')
          }
          const range = resolveDateRange(staffRangeInput(input))
          return {
            kind: 'data',
            data: staffStats(await getStaffSummaries(ctx.tenantId, range), range),
          }
        }
        default: {
          const [kpis, daily, heat] = await Promise.all([
            getKpis(ctx.tenantId),
            getDailyMetrics(ctx.tenantId, STATS_DAYS),
            getHeatmap(ctx.tenantId),
          ])
          return { kind: 'data', data: overviewStats({ kpis, daily, heat }) }
        }
      }
    },
  }),

  defineTool({
    name: 'ver_como_nos_fue',
    description:
      'Cómo nos fue: una noche (personas, reservas, pauta y cuenta), todas las fechas de un evento con su rentabilidad, la pauta de Meta y el retorno de un mes, o los cumpleaños de un mes.',
    input: z.object({
      vista: z
        .enum(['dia', 'evento', 'pauta', 'cumples'])
        .optional()
        .describe('Por día, por evento, pauta del mes o cumpleaños. Sin esto, por día.'),
      fecha: dayField('En por día. Sin esto, la última noche con gente.').optional(),
      evento: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('En por evento: nombre o id. Sin esto, la lista de eventos.'),
      mes: monthField('En pauta y cumpleaños, yyyy-MM. Sin esto, el actual.').optional(),
    }),
    need: OWNER,
    doing: () => 'Mirando cómo nos fue',
    done: () => 'Miré cómo nos fue',
    run: async (input, ctx) => {
      const tenantId = ctx.tenantId
      const { today } = ctx
      switch (input.vista ?? 'dia') {
        case 'evento': {
          const { options, truncated } = await listEventTemplateOptions({ tenantId, today })
          if (!input.evento) return { kind: 'data', data: templateOptionsData(options, truncated) }
          const found = pickNamed(options, input.evento, {
            option: (option) => `${option.name} (id ${option.id})`,
            none: `No encontré el evento «${input.evento}». Mirá la lista con ver_como_nos_fue, vista evento.`,
          })
          if (!found.ok) return fail(found.message)
          const report = await getTemplateReport({
            tenantId,
            templateId: found.value.id,
            today,
          })
          if (!report) return fail('Ese evento ya no está.')
          return { kind: 'data', data: templateReportData(report) }
        }
        case 'pauta': {
          const month = texMonth(input.mes, today)
          if (!month.ok) return fail(month.message)
          return {
            kind: 'data',
            data: monthPautaData(
              await getMonthMarketingReport({ tenantId, ym: month.month, today }),
            ),
          }
        }
        case 'cumples': {
          const month = texMonth(input.mes, today)
          if (!month.ok) return fail(month.message)
          return {
            kind: 'data',
            data: birthdaysData(await getMonthBirthdayReport({ tenantId, ym: month.month, today })),
          }
        }
        default: {
          if (input.fecha && !isRealIsoDay(input.fecha)) return fail('Esa fecha no existe.')
          // Como la pantalla: abre en la última noche con reservas en pie.
          const day =
            input.fecha ??
            (await listRecentReservationDays({ tenantId, until: today, limit: 1 }))[0]?.day ??
            today
          return { kind: 'data', data: dayReportData(await getDayReport({ tenantId, day }), today) }
        }
      }
    },
  }),

  defineTool({
    name: 'ver_resenas',
    description:
      'Las reseñas de los clientes: el puntaje promedio, cuántas hay de cada estrella y los comentarios, de las últimas a las primeras. Se puede filtrar por estrellas.',
    input: z.object({
      estrellas: z.number().int().min(1).max(5).optional().describe('Solo las de este puntaje.'),
      cantidad: z
        .number()
        .int()
        .min(1)
        .max(REVIEWS_MAX)
        .optional()
        .describe('Cuántos comentarios.'),
    }),
    need: { roles: OWNER_ONLY, feature: 'reviews' },
    doing: () => 'Mirando las reseñas',
    done: () => 'Miré las reseñas',
    run: async (input, ctx) => {
      const rating = input.estrellas as 1 | 2 | 3 | 4 | 5 | undefined
      const [insights, reviews] = await Promise.all([
        getReviewInsights(ctx.tenantId),
        listReviews({
          tenantId: ctx.tenantId,
          rating,
          limit: input.cantidad ?? REVIEWS_DEFAULT,
        }),
      ])
      return { kind: 'data', data: reviewsData(insights, reviews, input.estrellas) }
    },
  }),
]
