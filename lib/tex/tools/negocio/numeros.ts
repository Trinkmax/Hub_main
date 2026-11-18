import 'server-only'

import { z } from 'zod'
import { isRealIsoDay } from '@/lib/dates'
import { getSetupStatus } from '@/lib/onboarding/setup'
import type { SetupStatus } from '@/lib/onboarding/steps'
import { getReviewInsights, listReviews } from '@/lib/reviews/queries'
import { getMonthBirthdayReport } from '@/lib/salon/birthday-queries'
import {
  getDayReport,
  getMonthMarketingReport,
  getTemplateReport,
  getTodaySalonOverview,
  listEventTemplateOptions,
  listRecentReservationDays,
} from '@/lib/salon/queries'
import { getBarPulse, getCustomerGrowth, listUpcomingEvents } from '@/lib/stats/pulse-queries'
import {
  getChurnRisk,
  getCommunicationStats,
  getDailyMetrics,
  getEventsRanking,
  getHeatmap,
  getKpis,
  getTopCustomersBySpent,
} from '@/lib/stats/queries'
import { requireTenantAccess } from '@/lib/tenant'
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
  templateOptionsData,
  templateReportData,
} from './_numeros-values'

/** Las estadísticas, Cómo nos fue y las reseñas son del dueño: sus páginas piden `['owner']`. */
const OWNER_ONLY: readonly TenantRole[] = ['owner']
const OWNER: TexToolNeed = { roles: OWNER_ONLY }

/** Lo que muestra cada pantalla: el Resumen mira 30 días (y los 30 anteriores); Estadísticas, 90. */
const HOME_WINDOW_DAYS = 30
const UPCOMING_DAYS = 7
const STATS_DAYS = 90
const TOP_MAX = 50
const TOP_DEFAULT = 15
const CHURN_READ = 200
const EVENTS_READ = 20
const REVIEWS_DEFAULT = 15
const REVIEWS_MAX = 40

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

/** Los primeros pasos del bar (`lib/onboarding`): la misma lectura que hace el Resumen. */
async function setupFacts(ctx: TexToolContext): Promise<SetupStatus> {
  const { tenant } = await requireTenantAccess(ctx.slug)
  return getSetupStatus({
    tenantId: ctx.tenantId,
    today: ctx.today,
    settings: (tenant.settings ?? null) as Record<string, unknown> | null,
  })
}

export const numerosTools = [
  defineTool({
    name: 'ver_inicio',
    description:
      'El Resumen del dueño: cómo viene hoy, la gente que vino en 30 días contra los 30 anteriores, la asistencia, los clientes nuevos, los consumos con puntos, los eventos de la semana con sus anotados y lo que falta configurar.',
    input: noInput,
    need: OWNER,
    doing: () => 'Mirando el resumen',
    done: () => 'Miré el resumen',
    run: async (_input, ctx) => {
      const since = new Date(Date.now() - HOME_WINDOW_DAYS * 86_400_000).toISOString()
      const [pulse, customers, club, upcoming, today, setup] = await Promise.all([
        getBarPulse({ tenantId: ctx.tenantId, today: ctx.today, windowDays: HOME_WINDOW_DAYS }),
        getCustomerGrowth({ tenantId: ctx.tenantId, since }),
        getKpis(ctx.tenantId),
        listUpcomingEvents({ tenantId: ctx.tenantId, today: ctx.today, days: UPCOMING_DAYS }),
        getTodaySalonOverview({ tenantId: ctx.tenantId, date: ctx.today }),
        setupFacts(ctx),
      ])
      return {
        kind: 'data',
        data: homeData({ today, pulse, customers, club, upcoming, setup }),
      }
    },
  }),

  defineTool({
    name: 'ver_estadisticas',
    description:
      'Las estadísticas de los consumos con puntos: clientes, consumos, lo cargado, ticket promedio y horarios fuertes; top de clientes y en riesgo de irse; eventos por asistencia; difusiones.',
    input: z.object({
      seccion: z
        .enum(['resumen', 'clientes', 'eventos', 'comunicacion'])
        .optional()
        .describe('Sin esto, el resumen.'),
      cantidad: z.number().int().min(1).max(TOP_MAX).optional().describe('En clientes: cuántos.'),
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
