import 'server-only'

import type { z } from 'zod'
import {
  cancelSalonReservation,
  closeTable,
  createSalonReservation,
  deleteScheduledEvent,
  moveScheduledEvent,
  transitionStatus,
  updateActualGuests,
  updateReservationTableLabel,
  updateSalonReservation,
  upsertScheduledEvent,
  upsertScheduledTemplate,
} from '@/lib/salon/actions'
import { occupiedTables, serviceDayInCordoba } from '@/lib/salon/operativo'
import {
  getSalonReservation,
  listManagers,
  listSalonReservations,
  listScheduledEventsForDate,
  listScheduledTemplates,
  listTimelineForDate,
  type ScheduledEventWithTemplate,
} from '@/lib/salon/queries'
import { cancelReservationSchema } from '@/lib/salon/schemas'
import {
  removeSegmentOverride,
  saveSegmentConfig,
  upsertSegmentOverride,
} from '@/lib/salon/segment-actions'
import { getSegmentEditorData } from '@/lib/salon/segment-queries'
import {
  segmentConfigSaveSchema,
  segmentOverrideKeySchema,
  segmentOverrideSchema,
} from '@/lib/salon/segment-schemas'
import {
  computeDaySegments,
  eventDisplayName,
  isoDowOf,
  projectReservation,
  type ReservationCandidate,
  resolveSegmentSettings,
} from '@/lib/salon/segments'
import { coversOf, occupiesTable } from '@/lib/salon/services'
import type { ScheduledEventTemplateRow } from '@/lib/salon/types'
import { fullUpdatePayload } from '@/lib/salon/update-payload'
import {
  RESERVATION_OPERATOR_ROLES,
  RESERVATION_STAFF_ROLES,
  TEMPLATE_EDIT_ROLES,
} from '@/lib/tenant/roles'
import { texScreenHref } from '../../screens'
import { simpleExecutor } from '../../simple-action'
import {
  dayText,
  defineTool,
  type TexExecutor,
  type TexToolContext,
  type TexToolResult,
} from '../types'
import {
  cancelEventDraft,
  cancelEventInput,
  cancelEventPayload,
  cancelReservationDraft,
  cancelReservationInput,
  changeNeedsCapacity,
  changeReservationDraft,
  changeReservationInput,
  changeReservationPayload,
  eventDraft,
  eventInput,
  eventPayload,
  joinNote,
  newReservationDraft,
  newReservationInput,
  newReservationPayload,
  overCapacityWarning,
  specialCapacityDraft,
  specialCapacityInput,
  statusChangeDraft,
  statusChangeInput,
  statusChangePayload,
  templateDraft,
  templateInput,
  templatePayload,
  weeklyCapacityDraft,
  weeklyCapacityInput,
} from './_drafts'
import {
  activeEventFlow,
  customerByPhone,
  findCake,
  findCustomer,
  findEvent,
  findManagerIn,
  findReservation,
  findTemplate,
  managerChoice,
  reservationManager,
  snapshotOrNull,
} from './_resolve'
import { CONFIGURABLE_SEGMENT_OF_WORD, ISO_DOW_OF_WORD, OWNER_ONLY, toSimpleState } from './_words'

/**
 * Lo que Tex puede preparar en Reservas y Calendario. Ninguna herramienta escribe: arma un tique. Al
 * confirmarlo corre la misma server action del formulario, con sus permisos y su auditoría.
 *
 * Quedan afuera a propósito, porque se deciden en su pantalla: devolver plata, confirmar transferencias,
 * anular entradas, conectar Mercado Pago, el Excel del calendario, pasar lista en bloque y pagar
 * comisiones.
 */

const fail = (message: string): TexToolResult => ({ kind: 'error', message })

function hrefOf(link: ReturnType<typeof texScreenHref>): string | null {
  return link.ok ? link.href : null
}

// ─── Reservas ────────────────────────────────────────────────────────────────

export const agendaActionTools = [
  defineTool({
    name: 'preparar_reserva',
    description:
      'Prepara una reserva nueva: «mesa para 4 el viernes a las 21», «reservá para 6 a nombre de Ana», «un cumple de 15 con torta en el evento del sábado». No guarda nada: muestra un tique para confirmar, con cómo queda el cupo.',
    input: newReservationInput,
    need: { roles: RESERVATION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando la reserva',
    done: () => 'Preparé la reserva',
    run: async (input, ctx) => {
      let event: ScheduledEventWithTemplate | null = null
      if (input.evento) {
        const found = await findEvent(ctx, input.evento, input.fecha)
        if (!found.ok) return fail(found.message)
        event = found.value
        if (input.fecha && input.fecha !== event.event_date) {
          return fail(
            `${eventDisplayName(event)} es del ${dayText(event.event_date)}, no del ${dayText(input.fecha)}: preguntale cuál.`,
          )
        }
      }
      const date = event?.event_date ?? input.fecha ?? ctx.today

      const [manager, managers, snapshot, dayEvents, cake, customer] = await Promise.all([
        reservationManager(ctx, input.gestor),
        input.asistente ? listManagers({ tenantId: ctx.tenantId, onlyActive: true }) : null,
        snapshotOrNull(ctx, date),
        listScheduledEventsForDate({ tenantId: ctx.tenantId, date }),
        input.torta ? findCake(ctx, input.torta) : null,
        input.cliente
          ? findCustomer(ctx, input.cliente)
          : input.telefono
            ? customerByPhone(ctx, input.telefono).then((value) => ({ ok: true as const, value }))
            : null,
      ])
      if (!manager.ok) return fail(manager.message)
      if (cake && !cake.ok) return fail(cake.message)
      if (customer && !customer.ok) return fail(customer.message)

      let assistant = null
      if (input.asistente && managers) {
        const found = findManagerIn(managers, input.asistente)
        if (!found.ok) return fail(found.message)
        assistant = managerChoice(found.value)
      }

      let template: ScheduledEventTemplateRow | null = null
      if (input.formato) {
        const found = await findTemplate(ctx, input.formato, { onlyActive: true })
        if (!found.ok) return fail(found.message)
        const already = dayEvents.find((e) => e.template_id === found.value.id)
        if (already) event = already
        else template = found.value
      }

      const eventFlow =
        (event || template) && (customer?.value || input.telefono)
          ? await activeEventFlow(ctx)
          : null

      const draft = newReservationDraft(input, {
        today: ctx.today,
        date,
        snapshot,
        settings: snapshot?.settings ?? resolveSegmentSettings([]),
        event,
        dayEvents,
        template,
        manager: manager.value,
        assistant,
        cake: cake?.ok ? cake.value : null,
        customer: customer?.ok ? customer.value : null,
        eventFlow,
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: { executor: 'agenda.reserva', payload: draft.payload, ticket: draft.ticket },
      }
    },
  }),

  defineTool({
    name: 'preparar_cambio_reserva',
    description:
      'Prepara un cambio en una reserva: día, hora, personas, mesa, nota, planta, evento, seña, torta o gestor. «Pasá la de García a las 22», «ahora son 8», «ponela en la mesa 12». No guarda nada: muestra un tique para confirmar.',
    input: changeReservationInput,
    need: { roles: RESERVATION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando el cambio',
    done: () => 'Preparé el cambio',
    run: async (input, ctx) => {
      const found = await findReservation(ctx, input.reserva, input.de_la_fecha, {
        // La mesa se asigna con la gente adelante: es la reserva de esta noche.
        preferDate: input.mesa !== undefined ? serviceDayInCordoba() : undefined,
      })
      if (!found.ok) return fail(found.message)
      const r = found.value
      const date = input.fecha ?? r.reservation_date
      const [target, managers, cake, snapshot, night, eventFlow] = await Promise.all([
        input.evento ? findEvent(ctx, input.evento, date) : null,
        input.gestor ? listManagers({ tenantId: ctx.tenantId, onlyActive: true }) : null,
        input.torta ? findCake(ctx, input.torta) : null,
        changeNeedsCapacity(input) ? snapshotOrNull(ctx, date) : null,
        input.mesa ? listTimelineForDate({ tenantId: ctx.tenantId, date }) : [],
        input.evento && r.customer_id ? activeEventFlow(ctx) : null,
      ])
      if (target && !target.ok) return fail(target.message)
      if (cake && !cake.ok) return fail(cake.message)
      let manager = null
      if (input.gestor && managers) {
        const chosen = findManagerIn(managers, input.gestor)
        if (!chosen.ok) return fail(chosen.message)
        manager = managerChoice(chosen.value)
      }
      const draft = changeReservationDraft(r, input, {
        snapshot,
        settings: snapshot?.settings ?? resolveSegmentSettings([]),
        targetEvent: target?.ok ? target.value : null,
        manager,
        cake: cake?.ok ? cake.value : null,
        occupied: occupiedTables(night, r.id),
        eventFlow,
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'agenda.cambio_reserva',
          payload: draft.payload,
          ticket: draft.ticket,
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_estado_reserva',
    description:
      'Prepara marcar una reserva como que llegó, no vino, se sentó o se cerró la mesa, o volverla atrás. «Llegó García, son 5, mesa 12», «los Pérez no vinieron», «cerrá la mesa de Ana». No guarda nada: muestra un tique para confirmar.',
    input: statusChangeInput,
    need: { roles: RESERVATION_OPERATOR_ROLES },
    mood: 'working',
    doing: () => 'Preparando el estado',
    done: () => 'Preparé el estado',
    run: async (input, ctx) => {
      const serviceDay = serviceDayInCordoba()
      const found = await findReservation(ctx, input.reserva, input.de_la_fecha, {
        preferDate: serviceDay,
      })
      if (!found.ok) return fail(found.message)
      const r = found.value
      const night = input.mesa
        ? await listTimelineForDate({ tenantId: ctx.tenantId, date: r.reservation_date })
        : []
      const draft = statusChangeDraft(r, input, {
        serviceDay,
        occupied: occupiedTables(night, r.id),
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'agenda.estado_reserva',
          payload: draft.payload,
          ticket: draft.ticket,
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_cancelar_reserva',
    description:
      'Prepara cancelar una reserva: «cancelá la de García», «los Pérez avisaron que no vienen». Libera el lugar. El tique avisa si tiene seña o si es una compra online. No guarda nada: muestra un tique para confirmar.',
    input: cancelReservationInput,
    need: { roles: RESERVATION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando la cancelación',
    done: () => 'Preparé la cancelación',
    run: async (input, ctx) => {
      const found = await findReservation(ctx, input.reserva, input.de_la_fecha)
      if (!found.ok) return fail(found.message)
      const draft = cancelReservationDraft(found.value, input)
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'agenda.cancelar_reserva',
          payload: draft.payload,
          ticket: draft.ticket,
        },
      }
    },
  }),

  // ─── Eventos y formatos ────────────────────────────────────────────────────

  defineTool({
    name: 'preparar_evento',
    description:
      'Prepara poner un evento en el calendario o cambiar uno: fecha, hora, cupo, puntos por asistir, grupo privado. «Programá el formato X el sábado 15», «subile el cupo a 80 al evento del sábado», «pasalo a las 20». No guarda nada: muestra un tique para confirmar.',
    input: eventInput,
    need: { roles: RESERVATION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando el evento',
    done: () => 'Preparé el evento',
    run: async (input, ctx) => {
      let existing: ScheduledEventWithTemplate | null = null
      if (input.evento) {
        const found = await findEvent(ctx, input.evento, input.de_la_fecha)
        if (!found.ok) return fail(found.message)
        existing = found.value
      } else {
        if (!input.formato) return fail('Preguntale qué formato es. Mirá ver_formatos.')
        if (!input.fecha) return fail('Preguntale para qué fecha.')
      }
      const date = input.fecha ?? existing?.event_date ?? ctx.today

      const [template, snapshot, dayEvents, reservations] = await Promise.all([
        input.formato ? findTemplate(ctx, input.formato, { onlyActive: !existing }) : null,
        snapshotOrNull(ctx, date),
        listScheduledEventsForDate({ tenantId: ctx.tenantId, date }),
        existing
          ? listSalonReservations({
              tenantId: ctx.tenantId,
              scheduledEventId: existing.id,
              excludeStatus: ['cancelled', 'no_show'],
              page: 1,
              pageSize: 200,
            })
          : null,
      ])
      if (template && !template.ok) return fail(template.message)

      const draft = eventDraft(input, {
        existing,
        template: template?.ok ? template.value : null,
        date,
        snapshot,
        dayEvents,
        active: {
          reservations: reservations?.total ?? 0,
          people: (reservations?.rows ?? []).reduce((sum, r) => sum + coversOf(r), 0),
        },
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: { executor: 'agenda.evento', payload: draft.payload, ticket: draft.ticket },
      }
    },
  }),

  defineTool({
    name: 'preparar_cancelar_evento',
    description:
      'Prepara sacar un evento del calendario: «cancelá el evento del sábado». Se borra la fecha, y no se puede si tiene reservas activas. No guarda nada: muestra un tique para confirmar.',
    input: cancelEventInput,
    need: { roles: RESERVATION_STAFF_ROLES },
    mood: 'working',
    doing: () => 'Preparando la cancelación',
    done: () => 'Preparé la cancelación',
    run: async (input, ctx) => {
      const found = await findEvent(ctx, input.evento, input.de_la_fecha)
      if (!found.ok) return fail(found.message)
      const { rows } = await listSalonReservations({
        tenantId: ctx.tenantId,
        scheduledEventId: found.value.id,
        page: 1,
        pageSize: 200,
      })
      const draft = cancelEventDraft(found.value, {
        active: rows.filter(occupiesTable).length,
        fallenUnplaced: rows.filter((r) => !occupiesTable(r) && r.zone === 'event_floating').length,
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: 'agenda.cancelar_evento',
          payload: draft.payload,
          ticket: draft.ticket,
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_formato',
    description:
      'Prepara un formato de evento nuevo o un cambio en uno: nombre, cupo con el que nacen sus fechas, servicio, color. «Creá un formato que se llame X, para 50». No guarda nada: muestra un tique para confirmar.',
    input: templateInput,
    need: { roles: TEMPLATE_EDIT_ROLES },
    mood: 'working',
    doing: () => 'Preparando el formato',
    done: () => 'Preparé el formato',
    run: async (input, ctx) => {
      const templates = await listScheduledTemplates({ tenantId: ctx.tenantId, onlyActive: false })
      let existing: ScheduledEventTemplateRow | null = null
      if (input.formato) {
        const found = await findTemplate(ctx, input.formato)
        if (!found.ok) return fail(found.message)
        existing = found.value
      }
      const draft = templateDraft(input, {
        existing,
        takenSlugs: templates.map((t) => t.slug),
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: { executor: 'agenda.formato', payload: draft.payload, ticket: draft.ticket },
      }
    },
  }),

  // ─── Cupos ─────────────────────────────────────────────────────────────────

  defineTool({
    name: 'preparar_cupo_especial',
    description:
      'Prepara un cupo especial de un servicio en una fecha: «subí la cena del sábado a 150», «abrimos la terraza el domingo», «cerrá el almuerzo del lunes» (cupo 0), o quitarlo. No guarda nada: muestra un tique para confirmar.',
    input: specialCapacityInput,
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el cupo',
    done: () => 'Preparé el cupo',
    run: async (input, ctx) => {
      const snapshot = await snapshotOrNull(ctx, input.fecha)
      const segment = snapshot
        ? computeDaySegments(snapshot).segments[CONFIGURABLE_SEGMENT_OF_WORD[input.servicio]]
        : null
      const draft = specialCapacityDraft(input, { segment, isoDow: isoDowOf(input.fecha) })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: {
          executor: draft.remove ? 'agenda.quitar_cupo_especial' : 'agenda.cupo_especial',
          payload: draft.payload,
          ticket: draft.ticket,
        },
      }
    },
  }),

  defineTool({
    name: 'preparar_cupo_semanal',
    description:
      'Prepara el cupo de un servicio para un día de la semana: «el almuerzo de los jueves tiene 80», o volver al cupo general. Rige para todos esos días. No guarda nada: muestra un tique para confirmar.',
    input: weeklyCapacityInput,
    need: { roles: OWNER_ONLY },
    mood: 'working',
    doing: () => 'Preparando el cupo',
    done: () => 'Preparé el cupo',
    run: async (input, ctx) => {
      const data = await getSegmentEditorData({ tenantId: ctx.tenantId, today: ctx.today })
      const segment = CONFIGURABLE_SEGMENT_OF_WORD[input.servicio]
      const isoDow = ISO_DOW_OF_WORD[input.dia]
      const draft = weeklyCapacityDraft(input, {
        current:
          data.weekly.find((row) => row.segment === segment && row.iso_dow === isoDow) ?? null,
        fallbackTotal: data.fallbackTotal,
      })
      if (!draft.ok) return fail(draft.message)
      return {
        kind: 'prepared',
        prepared: { executor: 'agenda.cupo_semanal', payload: draft.payload, ticket: draft.ticket },
      }
    },
  }),
]

// ─── Al confirmar ────────────────────────────────────────────────────────────

/**
 * El cupo se vuelve a mirar al confirmar, como el formulario al apretar Guardar: la anfitriona y los
 * socios cargan a la vez. Si el servicio se llenó mientras el tique estaba esperando, vuelve al tique
 * con el aviso; a la segunda, se carga. Si no se puede leer, sigue: el aviso nunca bloquea.
 */
export async function capacityReview(
  candidate: ReservationCandidate | null,
  acknowledged: boolean,
  ctx: TexToolContext,
) {
  if (acknowledged || !candidate) return null
  const snapshot = await snapshotOrNull(ctx, candidate.reservation_date)
  const projection = snapshot ? projectReservation(snapshot, candidate) : null
  return projection?.needsConfirm ? projection : null
}

function withCapacityCheck<P extends { candidate: unknown; capacityAck: boolean }>(
  schema: z.ZodType<P>,
  executor: TexExecutor,
): TexExecutor {
  return {
    run: async (raw, ctx) => {
      const parsed = schema.safeParse(raw)
      if (parsed.success) {
        const over = await capacityReview(
          parsed.data.candidate as ReservationCandidate | null,
          parsed.data.capacityAck,
          ctx,
        )
        if (over) {
          return {
            ok: false,
            kind: 'review',
            message: 'Mientras tanto se llenó ese servicio: miralo antes de seguir.',
            warnings: [overCapacityWarning(over)],
            payload: { ...parsed.data, capacityAck: true },
          }
        }
      }
      return executor.run(raw, ctx)
    },
  }
}

const STATUS_DONE = {
  pending: 'Volvió a «por llegar».',
  arrived: 'Marqué que llegó.',
  seated: 'Marqué que se sentó.',
  closed: 'Mesa cerrada.',
  no_show: 'Marqué que no vino.',
} as const

function reservationCardHref(ctx: TexToolContext, id: string | null): string | null {
  return id ? hrefOf(texScreenHref(ctx.slug, 'reservas.ficha', { id })) : null
}

function calendarHref(ctx: TexToolContext): string | null {
  return hrefOf(texScreenHref(ctx.slug, 'eventos.calendario'))
}

export const agendaExecutors: Readonly<Record<string, TexExecutor>> = {
  'agenda.reserva': withCapacityCheck(
    newReservationPayload,
    simpleExecutor(
      newReservationPayload,
      async (payload, ctx) => {
        const state = await createSalonReservation(ctx.slug, payload.values)
        const id = state.ok && typeof state.data?.id === 'string' ? state.data.id : null
        return toSimpleState(state, { id }, 'Reserva creada.')
      },
      (data, _payload, ctx) => ({ href: reservationCardHref(ctx, data.id) }),
    ),
  ),

  'agenda.cambio_reserva': withCapacityCheck(
    changeReservationPayload,
    simpleExecutor(
      changeReservationPayload,
      async (payload, ctx) => {
        const data = { id: payload.id }
        if (payload.save === 'mesa') {
          const state = await updateReservationTableLabel(ctx.slug, {
            id: payload.id,
            table_label: payload.patch.table_label,
          })
          return toSimpleState(state, data, 'Mesa guardada.')
        }
        if (payload.save === 'asistencia') {
          const state = await updateActualGuests(ctx.slug, {
            id: payload.id,
            actual_guests: payload.patch.actual_guests,
          })
          return toSimpleState(state, data, 'Guardé cuántos vinieron.')
        }
        // La fila de ahora, no la de cuando se armó el tique: lo que cambió otro no se pisa.
        const current = await getSalonReservation({ tenantId: ctx.tenantId, id: payload.id })
        if (!current) {
          return { ok: false, code: 'stale', message: 'Esa reserva ya no está.' }
        }
        const state = await updateSalonReservation(
          ctx.slug,
          fullUpdatePayload(current, {
            ...payload.patch,
            ...(payload.appendNote !== null
              ? { comments: joinNote(current.comments, payload.appendNote) }
              : {}),
          }),
        )
        return toSimpleState(state, data, 'Reserva actualizada.')
      },
      (data, _payload, ctx) => ({ href: reservationCardHref(ctx, data.id) }),
    ),
  ),

  'agenda.estado_reserva': simpleExecutor(
    statusChangePayload,
    async (payload, ctx) => {
      const data = { id: payload.id }
      if (payload.to === 'closed') {
        const state = await closeTable(ctx.slug, {
          id: payload.id,
          actual_guests: payload.actual_guests,
        })
        return toSimpleState(state, data, STATUS_DONE.closed)
      }
      const state = await transitionStatus(ctx.slug, {
        id: payload.id,
        to: payload.to,
        ...(payload.actual_guests !== null ? { actual_guests: payload.actual_guests } : {}),
        ...(payload.table_label !== undefined ? { table_label: payload.table_label } : {}),
      })
      return toSimpleState(state, data, STATUS_DONE[payload.to])
    },
    (data, payload, ctx) => {
      // La noche de hoy se mira en el tablero; cualquier otro día, en su ficha.
      const tonight = payload.date === serviceDayInCordoba()
      return tonight
        ? { href: hrefOf(texScreenHref(ctx.slug, 'operativo.tablero')), point: payload.name }
        : { href: reservationCardHref(ctx, data.id) }
    },
  ),

  'agenda.cancelar_reserva': simpleExecutor(
    cancelReservationSchema,
    async (payload, ctx) => {
      const state = await cancelSalonReservation(ctx.slug, {
        id: payload.id,
        reason: payload.reason ?? null,
      })
      return toSimpleState(state, { id: payload.id }, 'Reserva cancelada.')
    },
    (data, _payload, ctx) => ({ href: reservationCardHref(ctx, data.id) }),
  ),

  'agenda.evento': simpleExecutor(
    eventPayload,
    async (payload, ctx) => {
      const eventId = typeof payload.values.id === 'string' ? payload.values.id : null
      if (payload.moved && eventId) {
        // Es la acción la que controla que no le queden reservas colgadas de la fecha vieja.
        const moved = await moveScheduledEvent(ctx.slug, {
          id: eventId,
          event_date: payload.values.event_date,
        })
        if (!moved.ok || payload.onlyMove) {
          return toSimpleState(moved, { id: eventId as string | null }, 'Evento movido.')
        }
      }
      const saved = await upsertScheduledEvent(ctx.slug, payload.values)
      const id = saved.ok && typeof saved.data?.id === 'string' ? saved.data.id : eventId
      return toSimpleState(saved, { id }, eventId ? 'Evento actualizado.' : 'Evento programado.')
    },
    (data, _payload, ctx) => ({
      href: data.id ? hrefOf(texScreenHref(ctx.slug, 'eventos.ficha', { id: data.id })) : null,
    }),
  ),

  'agenda.cancelar_evento': simpleExecutor(
    cancelEventPayload,
    async (payload, ctx) => {
      const state = await deleteScheduledEvent(ctx.slug, payload.id)
      return toSimpleState(state, { id: payload.id }, 'Evento cancelado.')
    },
    (_data, _payload, ctx) => ({ href: calendarHref(ctx) }),
  ),

  'agenda.formato': simpleExecutor(
    templatePayload,
    async (payload, ctx) => {
      const state = await upsertScheduledTemplate(ctx.slug, payload.values)
      const name = typeof payload.values.name === 'string' ? payload.values.name : null
      return toSimpleState(
        state,
        { name },
        payload.values.id ? 'Formato actualizado.' : 'Formato creado.',
      )
    },
    (data, _payload, ctx) => ({
      href: hrefOf(texScreenHref(ctx.slug, 'eventos.calendario', { tab: 'eventos' })),
      point: data.name,
    }),
  ),

  'agenda.cupo_especial': simpleExecutor(
    segmentOverrideSchema,
    async (payload, ctx) => {
      const state = await upsertSegmentOverride(ctx.slug, payload)
      return toSimpleState(state, { fecha: payload.override_date }, 'Cupo especial guardado.')
    },
    (_data, _payload, ctx) => ({ href: calendarHref(ctx) }),
  ),

  'agenda.quitar_cupo_especial': simpleExecutor(
    segmentOverrideKeySchema,
    async (payload, ctx) => {
      const state = await removeSegmentOverride(ctx.slug, payload)
      return toSimpleState(state, { fecha: payload.override_date }, 'Cupo especial quitado.')
    },
    (_data, _payload, ctx) => ({ href: calendarHref(ctx) }),
  ),

  'agenda.cupo_semanal': simpleExecutor(
    segmentConfigSaveSchema,
    async (payload, ctx) => {
      const state = await saveSegmentConfig(ctx.slug, payload)
      return toSimpleState(state, null, 'Cupos guardados.')
    },
    (_data, _payload, ctx) => ({ href: calendarHref(ctx) }),
  ),
}
