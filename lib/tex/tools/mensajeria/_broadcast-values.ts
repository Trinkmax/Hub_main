import { fromZonedTime } from 'date-fns-tz'
import { categoryLabel } from '@/app/(manager)/[tenantSlug]/mensajeria/plantillas/_template-display'
import type { AudienceReach } from '@/lib/audiences/reach-filters'
import type { BroadcastListRow } from '@/lib/broadcasts/queries'
import {
  templateBodyParamCount,
  type VariableMapping,
  type VariableSource,
  type VariableSourceKey,
  variableDefinition,
  variableLabel,
} from '@/lib/broadcasts/variables'
import { isRealIsoDay } from '@/lib/dates/civil'
import { fillExamples, parseMetaComponents } from '@/lib/meta/template-components'
import type { BroadcastStatus, RecipientStatus } from '@/types/database'
import { capped, dayText, type TexTicketDraft } from '../types'
import { countText, dateTimeText, noZeros, peopleText, redactContact } from './_common'
import { parseHints, type TemplateRow, templateTitle } from './_template-values'

/**
 * Las difusiones, puras. Lo que importa de acá: a cuántas personas le llega de verdad, con qué y cuándo.
 * Lo calcula igual que `lib/broadcasts/engine.ts` al mandar, y el tique lo dice sin vueltas.
 */

const TZ = 'America/Argentina/Cordoba'
const LIST_MAX = 15

// ─── A cuántos les llega ─────────────────────────────────────────────────────

export {
  type AudienceReach,
  blockedFilter,
  optedInFilter,
  reachOf,
} from '@/lib/audiences/reach-filters'

export function noReachText(audience: string, total: number): string {
  return total === 0
    ? `«${audience}» hoy no tiene a nadie: no le llegaría a ninguna persona.`
    : `De los ${countText(total)} de «${audience}», ninguno acepta promos: no le llegaría a nadie. Solo les llega a los que aceptaron recibir promos y no están en «No contactar».`
}

/** Tiene que coincidir con lo que dice el botón: si se movió mucho, la persona lo vuelve a ver. */
export function reachChanged(promised: number, now: number): boolean {
  return Math.abs(promised - now) > Math.max(5, Math.ceil(promised * 0.05))
}

// ─── Cuándo sale ─────────────────────────────────────────────────────────────

export type BroadcastWhen =
  | { ok: true; mode: 'now' }
  | { ok: true; mode: 'at'; iso: string; text: string }
  | { ok: false; message: string }

const WHEN_RE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::\d{2})?$/

/** `ahora`, o una fecha y hora de Córdoba. Una que ya pasó saldría en el acto: se rechaza. */
export function parseWhen(raw: string, nowMs: number): BroadcastWhen {
  const value = raw.trim().toLowerCase()
  if (value === 'ahora') return { ok: true, mode: 'now' }
  const match = WHEN_RE.exec(raw.trim())
  if (!match || !isRealIsoDay(match[1])) {
    return { ok: false, message: 'cuando: mandá «ahora» o una fecha y hora yyyy-MM-ddTHH:mm.' }
  }
  const at = fromZonedTime(`${match[1]}T${match[2]}:${match[3]}:00`, TZ)
  if (at.getTime() <= nowMs) {
    return { ok: false, message: 'Esa fecha y hora ya pasaron: preguntale para cuándo la quiere.' }
  }
  const iso = at.toISOString()
  return { ok: true, mode: 'at', iso, text: dateTimeText(iso) ?? iso }
}

// ─── Los huecos de la plantilla ──────────────────────────────────────────────

export type HoleInput = {
  numero: number
  dato?: VariableSourceKey
  texto?: string
  si_falta?: string
}

export type MappingResult =
  | { ok: true; mapping: VariableMapping; assumedName: boolean }
  | { ok: false; message: string }

/**
 * Qué va en cada hueco: lo que recuerda la plantilla o, si no, el nombre, como precarga el formulario.
 * Allá la persona ve el combo de cada hueco; acá no, así que solo se asume el primero, y el tique lo
 * dice. Un segundo hueco sin definir o un texto fijo no se adivinan: saldrían mal a toda la lista.
 */
export function buildMapping(
  template: Pick<TemplateRow, 'name' | 'components' | 'variable_hints'>,
  holes: readonly HoleInput[],
): MappingResult {
  const count = templateBodyParamCount(template.components)
  const title = templateTitle(template)
  const hints = parseHints(template.variable_hints)
  for (const hole of holes) {
    if (hole.numero > count) {
      return {
        ok: false,
        message: `«${title}» tiene ${count} ${count === 1 ? 'hueco' : 'huecos'}: no hay un hueco ${hole.numero}.`,
      }
    }
  }
  const mapping: VariableMapping = {}
  let assumedName = false
  for (let numero = 1; numero <= count; numero += 1) {
    const key = String(numero)
    const hole = holes.find((h) => h.numero === numero)
    const known = hole?.dato ?? hints[key]
    if (!known && numero > 1) {
      return {
        ok: false,
        message: `«${title}» no dice qué va en el hueco ${numero}. Leé su texto con ver_plantillas, preguntale y mandalo en huecos.`,
      }
    }
    if (!known) assumedName = true
    const source: VariableSourceKey = known ?? 'first_name'
    const entry: VariableSource = { source }
    if (source === 'custom') {
      const value = hole?.texto?.trim()
      if (!value) {
        return {
          ok: false,
          message: `El hueco ${numero} de «${title}» es un texto fijo, igual para todos: preguntale qué va (por ejemplo, «este viernes») y mandalo en huecos.`,
        }
      }
      entry.value = value
    } else if (hole?.si_falta?.trim()) {
      entry.fallback = hole.si_falta.trim()
    }
    mapping[key] = entry
  }
  return { ok: true, mapping, assumedName }
}

/** Lo que falta a veces en una ficha: sin texto de respaldo, ese hueco saldría vacío. */
const MAY_BE_EMPTY: ReadonlySet<VariableSourceKey> = new Set(['birthdate', 'last_name'])

export function emptyHoleWarnings(mapping: VariableMapping) {
  return Object.entries(mapping)
    .filter(([, entry]) => MAY_BE_EMPTY.has(entry.source) && !entry.fallback)
    .map(([key, entry]) => ({
      key: `empty_hole_${key}`,
      title: `El hueco ${key} lleva «${variableLabel(entry.source)}»: al que no lo tenga cargado le puede fallar el envío.`,
      body: null,
    }))
}

/** `{{1}} Nombre · {{2}} «este viernes»`: qué se va a poner en cada hueco. */
export function holesText(mapping: VariableMapping): string {
  return Object.keys(mapping)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const entry = mapping[key]
      if (!entry) return `{{${key}}}`
      return `{{${key}}} ${entry.source === 'custom' ? `«${entry.value ?? ''}»` : variableLabel(entry.source)}`
    })
    .join(' · ')
}

/** Los valores de ejemplo: los mismos que muestra la vista previa del formulario. */
export function previewValues(mapping: VariableMapping): string[] {
  return Object.keys(mapping)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const entry = mapping[key]
      if (!entry) return ''
      return entry.source === 'custom'
        ? (entry.value ?? '')
        : (variableDefinition(entry.source)?.example ?? '')
    })
}

/** Lo que va a leer el cliente, entero: encabezado, cuerpo, pie y botones. */
export function messagePreview(components: unknown, values: readonly string[]): string {
  const parts = parseMetaComponents(components)
  const fill = (text: string) => fillExamples(text, [...values])
  return [
    parts.header ? fill(parts.header) : null,
    parts.body ? fill(parts.body) : 'Esta plantilla no tiene texto.',
    parts.footer,
    parts.buttons.length > 0 ? `[${parts.buttons.join('] [')}]` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
}

// ─── El tique ────────────────────────────────────────────────────────────────

export function defaultBroadcastName(
  template: Pick<TemplateRow, 'name'>,
  when: Extract<BroadcastWhen, { ok: true }>,
  today: string,
): string {
  const day = when.mode === 'at' ? when.text.slice(0, 5) : (dayText(today) ?? today).slice(0, 5)
  return `${templateTitle(template)} · ${day}`.slice(0, 120)
}

export function broadcastConfirmLabel(mode: 'now' | 'at', reach: number): string {
  return mode === 'now' ? `Mandar a ${peopleText(reach)}` : `Programar para ${peopleText(reach)}`
}

export function broadcastTicket(input: {
  name: string
  audienceName: string
  reach: AudienceReach
  template: Pick<TemplateRow, 'name' | 'category' | 'components'>
  mapping: VariableMapping
  assumedName: boolean
  when: Extract<BroadcastWhen, { ok: true }>
}): TexTicketDraft {
  const { reach, total } = input.reach
  const out = total - reach
  const now = input.when.mode === 'now'
  const hasHoles = Object.keys(input.mapping).length > 0
  return {
    kind: 'difusion',
    title: now ? 'Mandar una difusión' : 'Programar una difusión',
    subtitle: input.name,
    rows: [
      { label: 'A quién', value: `La lista «${input.audienceName}»` },
      ...(out > 0
        ? [
            {
              label: 'Quedan afuera',
              value: `${countText(out)}: no aceptan promos o están en «No contactar»`,
            },
          ]
        : []),
      {
        label: 'Plantilla',
        value: `${templateTitle(input.template)} (${categoryLabel(input.template.category)})`,
      },
      {
        label: hasHoles ? 'Así le llega (ejemplo)' : 'Así le llega',
        value: messagePreview(input.template.components, previewValues(input.mapping)),
      },
      ...(hasHoles ? [{ label: 'En cada hueco', value: holesText(input.mapping) }] : []),
      {
        label: 'Cuándo sale',
        value: input.when.mode === 'at' ? input.when.text : 'Apenas confirmes',
      },
    ],
    total: { label: 'Le llega a', value: peopleText(reach) },
    entry: [],
    warnings: [
      now
        ? {
            key: 'no_undo',
            title: 'Cuando sale no se puede deshacer: le llega a toda esa gente.',
            body: null,
          }
        : {
            key: 'can_cancel',
            title:
              'Se puede cancelar hasta que empiece a salir. Después, no se puede deshacer: le llega a toda esa gente.',
            body: null,
          },
      {
        key: 'recount',
        title:
          'La lista se vuelve a contar justo antes de salir: el número final se puede mover un poco.',
        body: null,
      },
      ...(input.assumedName
        ? [
            {
              key: 'assumed_name',
              title:
                'La plantilla no dice qué va en el hueco 1: puse el nombre de cada cliente. Fijate que tenga sentido.',
              body: null,
            },
          ]
        : []),
      ...emptyHoleWarnings(input.mapping),
    ],
    confirmLabel: broadcastConfirmLabel(input.when.mode, reach),
  }
}

// ─── Lo que lee Tex ──────────────────────────────────────────────────────────

export const BROADCAST_STATUS_LABEL: Readonly<Record<BroadcastStatus, string>> = {
  draft: 'Borrador',
  scheduled: 'Programada',
  sending: 'Enviando',
  sent: 'Enviada',
  partial: 'Enviada con fallas',
  failed: 'Fallida',
  cancelled: 'Cancelada',
}

export const BROADCAST_STATE_FILTER = {
  programadas: ['scheduled', 'draft'],
  enviando: ['sending'],
  enviadas: ['sent', 'partial', 'failed'],
  canceladas: ['cancelled'],
} as const satisfies Record<string, readonly BroadcastStatus[]>

/**
 * Cada destinatario está en UN casillero, el último al que llegó: quien leyó ya no cuenta como enviado.
 * Lo que la gente pregunta es acumulado («a cuántos les llegó»): acá se suman los pasos.
 */
export function broadcastFunnel(stats: Readonly<Record<string, number>>) {
  const sent = stats.sent ?? 0
  const delivered = stats.delivered ?? 0
  const read = stats.read ?? 0
  const replied = stats.replied ?? 0
  return {
    destinatarios: stats.total ?? 0,
    enviados: sent + delivered + read + replied,
    entregados: delivered + read + replied,
    leidos: read + replied,
    respondieron: replied,
    fallidos: stats.failed ?? 0,
    quedaron_afuera: stats.excluded ?? 0,
  }
}

const SENT_STATES: ReadonlySet<BroadcastStatus> = new Set(['sending', 'sent', 'partial', 'failed'])

function whenText(
  row: Pick<BroadcastListRow, 'status' | 'scheduled_at' | 'started_at' | 'completed_at'>,
) {
  if (row.status === 'scheduled' && row.scheduled_at) {
    return `Sale el ${dateTimeText(row.scheduled_at)}`
  }
  return dateTimeText(row.completed_at ?? row.started_at ?? row.scheduled_at) ?? undefined
}

export function broadcastRow(row: BroadcastListRow) {
  const when = whenText(row)
  return {
    id: row.id,
    nombre: row.name,
    estado: BROADCAST_STATUS_LABEL[row.status],
    ...(when ? { cuando: when } : {}),
    ...(SENT_STATES.has(row.status) ? noZeros(broadcastFunnel(row.stats)) : {}),
  }
}

/** Las difusiones llegan de la más nueva a la más vieja. */
export function broadcastsData(rows: readonly BroadcastListRow[]) {
  const scheduled = rows.filter((row) => row.status === 'scheduled').length
  const sending = rows.filter((row) => row.status === 'sending').length
  const { filas, hay_mas } = capped(rows.map(broadcastRow), LIST_MAX)
  return {
    cuantas: rows.length,
    ...(scheduled > 0 ? { programadas: scheduled } : {}),
    ...(sending > 0 ? { enviando_ahora: sending } : {}),
    filas,
    hay_mas,
  }
}

/** Lo que deja hacer la pantalla de una difusión (`broadcast-actions.tsx`). */
export function broadcastActions(status: BroadcastStatus, failedCount: number) {
  const open = status === 'scheduled' || status === 'draft'
  return {
    mandar_ahora: open,
    cancelar: open,
    reenviar_fallidos:
      (status === 'sent' || status === 'partial' || status === 'failed') && failedCount > 0,
  }
}

/** Las mismas explicaciones que «Motivo» en la pantalla de la difusión. */
export function failureReason(raw: string | null): string {
  const reason = (raw ?? '').toLowerCase()
  if (reason.includes('131047') || reason.includes('re-engagement') || reason.includes('24 h')) {
    return 'Pasaron más de 24 h; hacía falta un mensaje aprobado.'
  }
  if (reason.includes('131030') || reason.includes('allowed list')) {
    return 'El número todavía no está habilitado para recibir.'
  }
  if (
    reason.includes('131026') ||
    reason.includes('undeliverable') ||
    reason.includes('not a whatsapp')
  ) {
    return 'No se pudo entregar (puede no tener WhatsApp).'
  }
  if (reason.includes('131042') || reason.includes('payment')) {
    return 'Falta configurar el método de pago en Meta.'
  }
  if (reason.includes('opt_out')) return 'El cliente dejó de aceptar promos antes del envío.'
  if (reason.includes('block')) return 'El cliente bloqueó los mensajes.'
  return 'No se pudo enviar.'
}

export type RecipientLike = {
  status: RecipientStatus
  error: string | null
  customer:
    | { first_name: string; last_name: string }
    | Array<{ first_name: string; last_name: string }>
    | null
}

function recipientName(recipient: RecipientLike): string | null {
  const customer = Array.isArray(recipient.customer) ? recipient.customer[0] : recipient.customer
  const name = customer ? `${customer.first_name} ${customer.last_name}`.trim() : ''
  return name ? redactContact(name) : null
}

/** De los últimos 200, como la pantalla: los motivos de los que fallaron y quiénes contestaron. */
export function recipientsSummary(recipients: readonly RecipientLike[]) {
  const reasons = new Map<string, number>()
  for (const recipient of recipients) {
    if (recipient.status !== 'failed') continue
    const reason = failureReason(recipient.error)
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  const replied = recipients
    .filter((recipient) => recipient.status === 'replied')
    .map(recipientName)
    .filter((name): name is string => name !== null)
  return {
    ...(reasons.size > 0
      ? { por_que_fallaron: [...reasons].map(([motivo, cuantos]) => ({ motivo, cuantos })) }
      : {}),
    ...(replied.length > 0 ? { respondieron_nombres: capped(replied, 10).filas } : {}),
  }
}

export type BroadcastDetailLike = BroadcastListRow & {
  channel: { display_name: string | null; type: string } | null
  template: { name: string; language: string } | null
  audience: { name: string; customer_count_cached: number } | null
}

export function broadcastData(
  broadcast: BroadcastDetailLike,
  recipients: readonly RecipientLike[],
  /** Las que todavía no salieron: a cuántos les llegaría hoy. */
  pendingReach: number | null,
) {
  const funnel = broadcastFunnel(broadcast.stats)
  const started = SENT_STATES.has(broadcast.status)
  const when = whenText(broadcast)
  return {
    id: broadcast.id,
    nombre: broadcast.name,
    estado: BROADCAST_STATUS_LABEL[broadcast.status],
    ...(when ? { cuando: when } : {}),
    ...(broadcast.template ? { plantilla: templateTitle(broadcast.template) } : {}),
    ...(broadcast.audience ? { audiencia: broadcast.audience.name } : {}),
    ...(pendingReach !== null ? { le_llegaria_hoy: pendingReach } : {}),
    ...(started
      ? {
          resultado: noZeros(funnel),
          // La pantalla muestra a cada persona en un solo casillero: por eso sus «Enviados» dan menos.
          en_pantalla: noZeros({
            enviados: broadcast.stats.sent ?? 0,
            entregados: broadcast.stats.delivered ?? 0,
            leidos: broadcast.stats.read ?? 0,
          }),
          nota: 'resultado va acumulado. La pantalla pone a cada persona solo en el último paso al que llegó (en_pantalla), por eso sus casilleros dan menos.',
          ...recipientsSummary(recipients),
        }
      : {}),
    se_puede: broadcastActions(broadcast.status, funnel.fallidos),
  }
}
