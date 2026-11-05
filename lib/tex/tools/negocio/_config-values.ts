import { isoDayInCordoba } from '@/lib/dates'
import type { LandingPageRow, LandingViewPoint } from '@/lib/landings/queries'
import { FEATURE_KEYS, FEATURE_REGISTRY, type TenantFeatures } from '@/lib/platform/features'
import type { PublicLinkPage, PublicLinkRow } from '@/lib/public-links/queries'
import type { ReviewSettings } from '@/lib/reviews/queries'
import type { SegmentEditorData } from '@/lib/salon/segment-queries'
import { CONFIGURABLE_SEGMENT_KEYS } from '@/lib/salon/segments'
import { SEGMENT_LABELS } from '@/lib/salon/segments-copy'
import { roleLabel } from '@/lib/tenant/roles'
import type { WelcomeRewardConfigWithReward } from '@/lib/welcome-reward/queries'
import { compact, shortText } from '../read/common'
import { capped, dayText, money } from '../types'

/**
 * Lo que Tex lee de la configuración y del marketing del bar, puro. Sin secretos ni contactos: del
 * WhatsApp de feedback se dice si está cargado, no cuál es; del equipo, el nombre y el rol, nunca el
 * mail. Lo prueba `tex-negocio.test.ts`.
 */

const DOW_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
] as const
const OVERRIDES_MAX = 15

// ─── Configuración ───────────────────────────────────────────────────────────

export function barData(input: {
  name: string
  timezone: string
  currency: string
  features: TenantFeatures
  cartaUrl: string
}) {
  return compact({
    nombre: input.name,
    zona_horaria: input.timezone,
    moneda: input.currency,
    carta_publica: input.cartaUrl,
    funciones_prendidas: FEATURE_KEYS.filter((key) => input.features[key]).map(
      (key) => FEATURE_REGISTRY[key].label,
    ),
  })
}

export function appearanceData(input: { logoUrl: string | null; brandAccent: string | null }) {
  return {
    logo: input.logoUrl ? 'Cargado' : 'Sin cargar: se muestra el nombre',
    color_de_marca: input.brandAccent ?? 'El de siempre',
  }
}

export function welcomeData(config: WelcomeRewardConfigWithReward) {
  return compact({
    regalo: config.enabled ? 'Activo' : 'Apagado',
    recompensa: config.reward?.name ?? null,
    titulo: config.headline,
    texto: config.subtext,
    puntos_de_regalo: config.bonus_points || null,
  })
}

export function reviewSettingsData(settings: ReviewSettings) {
  return {
    enlace_de_google: settings.googleMapsReviewUrl ?? 'Sin cargar',
    whatsapp_de_feedback: settings.feedbackWhatsappPhone ? 'Cargado' : 'Sin cargar',
    derivar_solo_5_estrellas: settings.reviewGatingEnabled,
    puntos_por_opinar: settings.reviewRewardPoints,
  }
}

export function salonData(input: {
  totalSeats: number | null
  zones: { planta_alta: number; planta_baja: number }
  editor: SegmentEditorData
}) {
  const { editor } = input
  const weekly = CONFIGURABLE_SEGMENT_KEYS.flatMap((segment) => {
    const cells = editor.weekly.filter((cell) => cell.segment === segment)
    const setting = editor.settings.find((row) => row.segment === segment)
    if (cells.length === 0 && !setting) return []
    return [
      compact({
        servicio: SEGMENT_LABELS[segment],
        hora_sugerida: setting?.default_time ?? null,
        cupo_por_dia: Object.fromEntries(
          cells
            .sort((a, b) => a.iso_dow - b.iso_dow)
            .map((cell) => [DOW_NAMES[cell.iso_dow - 1] ?? cell.iso_dow, cell.capacity]),
        ),
      }),
    ]
  })
  const special = capped(
    editor.overrides.map((row) =>
      compact({
        fecha: dayText(row.override_date),
        servicio: SEGMENT_LABELS[row.segment],
        cupo: row.capacity,
        motivo: shortText(row.reason, 60),
      }),
    ),
    OVERRIDES_MAX,
  )
  return compact({
    capacidad_total: input.totalSeats,
    planta_alta: input.zones.planta_alta,
    planta_baja: input.zones.planta_baja,
    cupo_general_por_servicio: editor.fallbackTotal,
    cupo_por_servicio: weekly.length > 0 ? weekly : null,
    cupos_especiales: special.filas.length > 0 ? special : null,
  })
}

/** Quién está y con qué rol. El mail no: viaja a la API de un tercero y acá no hace falta. */
export function teamData(rows: ReadonlyArray<{ full_name: string | null; role: string }>) {
  return {
    cuantos: rows.length,
    filas: rows.map((row) => ({
      nombre: row.full_name?.trim() || 'Sin nombre cargado',
      rol: roleLabel(row.role),
    })),
  }
}

export type AutoAcceptConfig = {
  guest_idle_hours_to_rescan: number
  session_auto_abandon_hours: number
  ticket_auto_accept_enabled: boolean
  ticket_auto_accept_max_cents: number | null
  ticket_auto_accept_max_items: number | null
  kitchen_flow_enabled: boolean
}

export function autoAcceptData(config: AutoAcceptConfig) {
  return compact({
    comandas_automaticas: config.ticket_auto_accept_enabled,
    hasta_monto:
      config.ticket_auto_accept_max_cents === null
        ? null
        : money(config.ticket_auto_accept_max_cents),
    hasta_items: config.ticket_auto_accept_max_items,
    pasa_por_cocina: config.kitchen_flow_enabled,
    pedir_escanear_de_nuevo_a_las_horas: config.guest_idle_hours_to_rescan,
    abandonar_mesa_a_las_horas: config.session_auto_abandon_hours,
  })
}

// ─── Marketing ───────────────────────────────────────────────────────────────

const when = (iso: string | null) => dayText(isoDayInCordoba(iso))

export function landingRow(page: LandingPageRow, base: string) {
  return compact({
    id: page.id,
    titulo: page.title,
    link: `${base}/${page.slug}`,
    publicada: page.published,
    visitas: page.views,
    ultima_visita: when(page.lastViewedAt),
    publicada_el: when(page.publishedAt),
    editada_el: when(page.updatedAt),
  })
}

export function landingsData(pages: readonly LandingPageRow[], base: string) {
  return {
    cuantas: pages.length,
    publicadas: pages.filter((page) => page.published).length,
    ...capped(
      pages.map((page) => landingRow(page, base)),
      40,
    ),
  }
}

/** Una página, con sus visitas de los últimos días. Nunca su HTML: es largo y no se edita desde acá. */
export function landingDetail(
  page: LandingPageRow,
  base: string,
  series: readonly LandingViewPoint[],
) {
  const days = series.filter((point) => point.views > 0)
  return {
    ...landingRow(page, base),
    visitas_ultimos_dias: series.reduce((total, point) => total + point.views, 0),
    por_dia: days.map((point) => ({ fecha: dayText(point.day), visitas: point.views })),
  }
}

export function publicLinksData(
  page: PublicLinkPage,
  links: readonly PublicLinkRow[],
  publicUrl: string,
) {
  return compact({
    link: publicUrl,
    pagina_prendida: page.active,
    titulo: page.headline,
    bio: page.bio,
    botones: links.map((link) =>
      compact({
        id: link.id,
        texto: link.label,
        a_donde: link.url,
        descripcion: link.description,
        destacado: link.highlight ? true : null,
        apagado: link.active ? null : true,
      }),
    ),
  })
}

// ─── Lo que se prepara ───────────────────────────────────────────────────────

/** Lo que recibe `updateWelcomeRewardConfig`, ya validado con su esquema. */
export type WelcomeForm = {
  enabled: boolean
  reward_id: string | null
  headline: string
  subtext: string
  bonus_points: number
}

/** El mismo FormData que arma `welcome-reward-form.tsx`. */
export function welcomeFormData(values: WelcomeForm): FormData {
  const form = new FormData()
  form.set('enabled', values.enabled ? 'true' : 'false')
  form.set('reward_id', values.reward_id ?? '')
  form.set('headline', values.headline)
  form.set('subtext', values.subtext)
  form.set('bonus_points', String(values.bonus_points))
  return form
}
