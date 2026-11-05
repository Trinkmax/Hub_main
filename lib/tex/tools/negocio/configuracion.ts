import 'server-only'

import { z } from 'zod'
import type { AccSimpleState } from '@/lib/accounting/action-state'
import { getTenantConfig } from '@/lib/admin/tenant-config'
import { getAppUrl } from '@/lib/app-url'
import { getLandingViewSeries, listLandingPages } from '@/lib/landings/queries'
import { getLandingsBase } from '@/lib/landings/urls'
import { getPublicLinkPage, listPublicLinks } from '@/lib/public-links/queries'
import { getReviewSettings } from '@/lib/reviews/queries'
import { setZoneCapacityDefaults } from '@/lib/salon/actions'
import { getZoneCapacityDefaults } from '@/lib/salon/queries'
import { zoneCapacityDefaultsSchema } from '@/lib/salon/schemas'
import { getSegmentEditorData } from '@/lib/salon/segment-queries'
import { createClient } from '@/lib/supabase/server'
import { requireTenantAccess } from '@/lib/tenant'
import { updateTotalSeatsAction } from '@/lib/tenant/actions'
import type { TenantRole } from '@/lib/tenant/types'
import { updateWelcomeRewardConfig } from '@/lib/welcome-reward/actions'
import { getWelcomeRewardConfig } from '@/lib/welcome-reward/queries'
import { updateWelcomeRewardConfigSchema } from '@/lib/welcome-reward/schemas'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  defineTool,
  noInput,
  type TexExecutor,
  type TexToolContext,
  type TexToolNeed,
  type TexToolResult,
  zodIssuesText,
} from '../types'
import { pickNamed, ticketWarning } from './_carta-values'
import {
  type AutoAcceptConfig,
  appearanceData,
  autoAcceptData,
  barData,
  landingDetail,
  landingsData,
  publicLinksData,
  reviewSettingsData,
  salonData,
  teamData,
  welcomeData,
  welcomeFormData,
} from './_config-values'

/** La configuración y el marketing son del dueño: sus páginas y sus acciones piden `['owner']`. */
const OWNER: TexToolNeed = { roles: ['owner'] as readonly TenantRole[] }

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

async function totalSeats(ctx: TexToolContext): Promise<number | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tenants')
    .select('total_seats')
    .eq('id', ctx.tenantId)
    .maybeSingle()
  return (data as { total_seats?: number | null } | null)?.total_seats ?? null
}

async function teamRows(ctx: TexToolContext) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_tenant_members', { p_tenant: ctx.tenantId })
  if (error) throw new Error('get_tenant_members')
  return (data ?? []) as Array<{ full_name: string | null; role: string }>
}

const SECTIONS = ['bar', 'apariencia', 'bienvenida', 'salon', 'resenas', 'equipo'] as const

const welcomePayload = z.object({
  enabled: z.boolean(),
  reward_id: z.uuid().nullable(),
  headline: z.string(),
  subtext: z.string(),
  bonus_points: z.number().int(),
})

const capacityPayload = z.object({
  total_seats: z.number().int().min(1).max(2000).optional(),
  zones: zoneCapacityDefaultsSchema.optional(),
})

export const configuracionTools = [
  defineTool({
    name: 'ver_configuracion',
    description:
      'La configuración del bar: datos del local, carta pública, funciones prendidas, apariencia (logo, color), regalo de bienvenida, capacidad del salón y cupos, reseñas, y el equipo con sus roles.',
    input: z.object({
      seccion: z.enum(SECTIONS).optional().describe('Sin esto, todo menos el equipo.'),
    }),
    need: OWNER,
    doing: () => 'Mirando la configuración',
    done: () => 'Miré la configuración',
    run: async (input, ctx) => {
      const section = input.seccion
      const wants = (name: (typeof SECTIONS)[number]) =>
        section === name || (section === undefined && name !== 'equipo')
      if (section === 'equipo') {
        return { kind: 'data', data: { equipo: teamData(await teamRows(ctx)) } }
      }
      const access =
        wants('bar') || wants('apariencia') ? await requireTenantAccess(ctx.slug) : null
      const [appUrl, welcome, reviews, seats, zones, editor, autoAccept] = await Promise.all([
        wants('bar') ? getAppUrl() : null,
        wants('bienvenida') ? getWelcomeRewardConfig(ctx.tenantId) : null,
        wants('resenas') ? getReviewSettings(ctx.tenantId) : null,
        wants('salon') ? totalSeats(ctx) : null,
        wants('salon') ? getZoneCapacityDefaults({ tenantId: ctx.tenantId }) : null,
        wants('salon') ? getSegmentEditorData({ tenantId: ctx.tenantId, today: ctx.today }) : null,
        wants('bar') && ctx.features.auto_accept ? getTenantConfig(ctx.slug) : null,
      ])
      const tenant = access?.tenant
      return {
        kind: 'data',
        data: {
          ...(tenant && appUrl !== null
            ? {
                bar: barData({
                  name: tenant.name,
                  timezone: tenant.timezone,
                  currency: tenant.currency,
                  features: ctx.features,
                  cartaUrl: `${appUrl}/carta/${ctx.slug}`,
                }),
              }
            : {}),
          ...(tenant && wants('apariencia')
            ? {
                apariencia: appearanceData({
                  logoUrl: tenant.logo_url,
                  brandAccent: tenant.brand_accent,
                }),
              }
            : {}),
          ...(welcome ? { bienvenida: welcomeData(welcome) } : {}),
          ...(zones && editor
            ? { salon: salonData({ totalSeats: seats ?? null, zones, editor }) }
            : {}),
          ...(reviews ? { resenas: reviewSettingsData(reviews) } : {}),
          ...(autoAccept
            ? { auto_aceptacion: autoAcceptData(autoAccept as AutoAcceptConfig) }
            : {}),
        },
      }
    },
  }),

  defineTool({
    name: 'ver_paginas',
    description:
      'Las páginas o landings del bar: cuáles están publicadas, su link y sus visitas. Con una página, sus visitas de los últimos 14 días. Subir o publicar se hace en la pantalla.',
    input: z.object({
      pagina: z.string().trim().min(1).optional().describe('Una página: título o id.'),
    }),
    need: OWNER,
    doing: () => 'Mirando las páginas',
    done: () => 'Miré las páginas',
    run: async (input, ctx) => {
      const [pages, base] = await Promise.all([listLandingPages(ctx.tenantId), getLandingsBase()])
      if (!input.pagina) return { kind: 'data', data: landingsData(pages, base) }
      const named = pages.map((page) => ({ ...page, name: page.title }))
      const found = pickNamed(named, input.pagina, {
        option: (page) => `${page.title} (id ${page.id})`,
        none: `No encontré la página «${input.pagina}».`,
      })
      if (!found.ok) return fail(found.message)
      const series = await getLandingViewSeries(ctx.tenantId, found.value.id)
      return { kind: 'data', data: landingDetail(found.value, base, series) }
    },
  }),

  defineTool({
    name: 'ver_link_instagram',
    description:
      'El link de la bio de Instagram del bar: su dirección, su título y los botones que tiene adentro. Cambiarlo se hace en su pantalla.',
    input: noInput,
    need: OWNER,
    doing: () => 'Mirando el link de Instagram',
    done: () => 'Miré el link de Instagram',
    run: async (_input, ctx) => {
      const [page, links, appUrl] = await Promise.all([
        getPublicLinkPage(ctx.tenantId),
        listPublicLinks(ctx.tenantId),
        getAppUrl(),
      ])
      return { kind: 'data', data: publicLinksData(page, links, `${appUrl}/l/${ctx.slug}`) }
    },
  }),

  defineTool({
    name: 'preparar_bienvenida',
    description:
      'Prepara cambiar los textos del regalo de bienvenida del club (título y texto), los puntos de regalo, o activarlo o apagarlo. Qué recompensa se regala se elige en la pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      titulo: z.string().trim().min(1).max(80).optional().describe('El título que ve el cliente.'),
      texto: z.string().trim().min(1).max(160).optional().describe('El texto de abajo.'),
      puntos_de_regalo: z.number().int().min(0).max(1_000_000).optional(),
      activa: z.boolean().optional().describe('true: lo activa. false: lo apaga.'),
    }),
    need: OWNER,
    mood: 'working',
    doing: () => 'Preparando la bienvenida',
    done: () => 'Preparé la bienvenida',
    run: async (input, ctx) => {
      const config = await getWelcomeRewardConfig(ctx.tenantId)
      const next = {
        enabled: input.activa ?? config.enabled,
        reward_id: config.reward_id,
        headline: input.titulo ?? config.headline,
        subtext: input.texto ?? config.subtext,
        bonus_points: input.puntos_de_regalo ?? config.bonus_points,
      }
      const valid = updateWelcomeRewardConfigSchema.safeParse(next)
      if (!valid.success) {
        return fail(
          valid.error.issues.some((issue) => issue.path[0] === 'reward_id')
            ? 'Para activarlo falta elegir qué recompensa se regala: se hace en Club › Bienvenida. Llevalo con ir_a a configuracion.bienvenida.'
            : zodIssuesText(valid.error),
        )
      }
      const rows = [
        ...(next.headline !== config.headline
          ? [{ label: 'Título', value: `${config.headline} → ${next.headline}` }]
          : []),
        ...(next.subtext !== config.subtext
          ? [{ label: 'Texto', value: `${config.subtext} → ${next.subtext}` }]
          : []),
        ...(next.bonus_points !== config.bonus_points
          ? [{ label: 'Puntos de regalo', value: `${config.bonus_points} → ${next.bonus_points}` }]
          : []),
        ...(next.enabled !== config.enabled
          ? [{ label: 'Regalo', value: next.enabled ? 'Se activa' : 'Se apaga' }]
          : []),
      ]
      if (rows.length === 0) return fail('Ya está así: no hay nada para cambiar.')
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.bienvenida',
          payload: valid.data,
          ticket: {
            kind: 'bienvenida',
            title: 'Regalo de bienvenida',
            subtitle: config.reward?.name ?? null,
            rows: [
              ...rows,
              ...(next.enabled === config.enabled
                ? [{ label: 'Regalo', value: next.enabled ? 'Sigue activo' : 'Sigue apagado' }]
                : []),
            ],
            total: null,
            entry: [],
            warnings: next.enabled
              ? [ticketWarning('clientes', 'Lo ven ya los clientes que se registran con el QR.')]
              : [],
            confirmLabel:
              rows.length === 1 && next.enabled !== config.enabled
                ? next.enabled
                  ? 'Activar el regalo'
                  : 'Apagar el regalo'
                : 'Guardar la bienvenida',
          },
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_capacidad',
    description:
      'Prepara cambiar la capacidad del local: cuánta gente entra en total y el cupo de planta alta y planta baja. El cupo por servicio y los especiales por fecha se cambian en la pantalla. No guarda nada: muestra un tique para confirmar.',
    input: z.object({
      capacidad_total: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe('Cuántas personas entran con el bar lleno.'),
      planta_alta: z.number().int().min(0).max(999).optional(),
      planta_baja: z.number().int().min(0).max(999).optional(),
    }),
    need: OWNER,
    mood: 'working',
    doing: () => 'Preparando la capacidad',
    done: () => 'Preparé la capacidad',
    run: async (input, ctx) => {
      const [seats, zones] = await Promise.all([
        totalSeats(ctx),
        getZoneCapacityDefaults({ tenantId: ctx.tenantId }),
      ])
      const wantsZones = input.planta_alta !== undefined || input.planta_baja !== undefined
      // La acción guarda las dos plantas juntas, y si la lectura falla da 0: no se pisa la otra sin
      // que la haya dicho.
      if (wantsZones) {
        if (input.planta_alta === undefined && zones.planta_alta === 0) {
          return fail('Preguntale también cuánta gente entra en planta alta.')
        }
        if (input.planta_baja === undefined && zones.planta_baja === 0) {
          return fail('Preguntale también cuánta gente entra en planta baja.')
        }
      }
      const nextZones = {
        planta_alta: input.planta_alta ?? zones.planta_alta,
        planta_baja: input.planta_baja ?? zones.planta_baja,
      }
      const zonesChange =
        wantsZones &&
        (nextZones.planta_alta !== zones.planta_alta || nextZones.planta_baja !== zones.planta_baja)
      const seatsChange = input.capacidad_total !== undefined && input.capacidad_total !== seats
      if (!zonesChange && !seatsChange) return fail('Ya está así: no hay nada para cambiar.')
      const payload = capacityPayload.safeParse({
        ...(seatsChange ? { total_seats: input.capacidad_total } : {}),
        ...(zonesChange ? { zones: nextZones } : {}),
      })
      if (!payload.success) return fail(zodIssuesText(payload.error))
      return {
        kind: 'prepared',
        prepared: {
          executor: 'negocio.capacidad',
          payload: payload.data,
          ticket: {
            kind: 'capacidad',
            title: 'Capacidad del local',
            subtitle: null,
            rows: [
              ...(seatsChange
                ? [
                    {
                      label: 'Capacidad total',
                      value: `${seats ?? 'Sin cargar'} → ${input.capacidad_total}`,
                    },
                  ]
                : []),
              ...(zonesChange && nextZones.planta_alta !== zones.planta_alta
                ? [
                    {
                      label: 'Planta alta',
                      value: `${zones.planta_alta} → ${nextZones.planta_alta}`,
                    },
                  ]
                : []),
              ...(zonesChange && nextZones.planta_baja !== zones.planta_baja
                ? [
                    {
                      label: 'Planta baja',
                      value: `${zones.planta_baja} → ${nextZones.planta_baja}`,
                    },
                  ]
                : []),
            ],
            total: null,
            entry: [],
            warnings: zonesChange
              ? [
                  ticketWarning(
                    'cupo_general',
                    'Planta alta más planta baja es el cupo de los servicios sin cupo propio: el calendario y las reservas lo usan ya.',
                  ),
                ]
              : [],
            confirmLabel: 'Guardar la capacidad',
          },
        },
      }
    },
  }),
]

export const configuracionExecutors: Readonly<Record<string, TexExecutor>> = {
  'negocio.bienvenida': simpleExecutor(
    welcomePayload,
    async (payload, ctx): Promise<AccSimpleState<null>> => {
      const state = await updateWelcomeRewardConfig(
        ctx.slug,
        { ok: true },
        welcomeFormData(payload),
      )
      return state.ok
        ? { ok: true, data: null, message: state.message ?? 'Guardé la bienvenida.' }
        : { ok: false, code: 'error', message: state.message }
    },
    (_data, _payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'configuracion.bienvenida')
      return { href: link.ok ? link.href : null }
    },
  ),

  'negocio.capacidad': simpleExecutor(
    capacityPayload,
    async (payload, ctx): Promise<AccSimpleState<null>> => {
      if (payload.total_seats !== undefined) {
        const seats = await updateTotalSeatsAction(ctx.slug, payload.total_seats)
        if (!seats.ok) return { ok: false, code: 'error', message: seats.message }
      }
      if (payload.zones) {
        const zones = await setZoneCapacityDefaults(ctx.slug, payload.zones)
        if (!zones.ok) {
          return {
            ok: false,
            code: 'error',
            message:
              payload.total_seats !== undefined
                ? `Guardé la capacidad total, pero no las plantas: ${zones.message}`
                : zones.message,
          }
        }
      }
      return { ok: true, data: null, message: 'Guardé la capacidad.' }
    },
    (_data, _payload, ctx) => {
      const link = texScreenHref(ctx.slug, 'configuracion.salon')
      return { href: link.ok ? link.href : null }
    },
  ),
}
