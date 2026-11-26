/**
 * Qué se le manda al teléfono por cada aviso de cocina, y qué se anota después — PURO y testeado
 * (`tests/lib/pos-notices-push-payload.test.ts`).
 *
 * El mensaje viaja cifrado y lo abre el service worker de la app, que con esto arma la notificación:
 * dice lo mismo que el aviso dentro de la app (`noticeText`) y lleva a la mesa.
 */
import type { PushOutcome, PushUrgency } from '@/lib/push/web-push'
import { noticeText } from './text'
import type { PosNotice } from './types'

/** Lo que recibe el service worker. `v` deja cambiar la forma más adelante sin romper al que no se actualizó. */
export type NoticePushPayload = {
  v: 1
  /** El aviso (`pos_notices.id`): la app abierta ya lo recibió en vivo y puede no repetirlo. */
  id: string
  title: string
  body: string
  /** Un aviso nuevo de la misma mesa y estación reemplaza al anterior en vez de apilarse. */
  tag: string
  /** Hay que ir a buscar algo: suena y vibra fuerte. */
  strong: boolean
  vibrate: number[]
  /** A dónde lleva tocar la notificación: la mesa. */
  url: string
}

export type NoticePush = {
  payload: NoticePushPayload
  urgency: PushUrgency
  /** Cuánto lo guarda el servicio de push si el teléfono no tiene señal. */
  ttlSeconds: number
  /** Con el teléfono sin señal, el aviso nuevo de la misma mesa y estación pisa al que no llegó. */
  topic: string
}

/** Un nombre de producto o de mesa desmedido no tiene que dejar afuera la notificación entera. */
const TITLE_MAX = 80
const BODY_MAX = 240

/** Corta por caracteres enteros, para no dejar un emoji partido al medio. */
function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** La pantalla de la mesa en el salón. */
export function noticeUrl(tenantSlug: string, sessionId: string): string {
  return `/${encodeURIComponent(tenantSlug)}/salon/mesa/${encodeURIComponent(sessionId)}`
}

/**
 * El mensaje de un aviso. «Para retirar» es lo único urgente: despierta al teléfono aunque esté
 * ahorrando batería y se guarda 10 minutos. Lo demás (empezó, todavía no) es informativo: si en
 * 5 minutos no llegó, ya no le sirve a nadie.
 */
export function noticePush(notice: PosNotice, tenantSlug: string): NoticePush {
  const text = noticeText(notice)
  const ready = notice.kind === 'ready'
  return {
    payload: {
      v: 1,
      id: notice.id,
      title: clip(text.title, TITLE_MAX),
      body: clip(text.body, BODY_MAX),
      tag: text.tag,
      strong: text.strong,
      vibrate: text.vibrate,
      url: noticeUrl(tenantSlug, notice.session_id),
    },
    urgency: ready ? 'high' : 'normal',
    ttlSeconds: ready ? 600 : 300,
    topic: text.tag,
  }
}

/** Cómo le fue a un aviso: cuántos envíos salieron, cuántos dieron con un teléfono dado de baja, etc. */
export type PushTally = { ok: number; gone: number; fail: number; skip: number }

export function emptyTally(): PushTally {
  return { ok: 0, gone: 0, fail: 0, skip: 0 }
}

/** «ok:2 gone:0 fail:1 skip:0»: lo que queda anotado en el aviso (`pos_notices.push_result`). */
export function pushResultLabel(tally: PushTally): string {
  return `ok:${tally.ok} gone:${tally.gone} fail:${tally.fail} skip:${tally.skip}`
}

/** A la docena de vueltas seguidas sin poder entregarle nada, la suscripción se da por perdida. */
export const MAX_PUSH_FAILURES = 12

export type SubscriptionFate =
  | { action: 'ok' }
  | { action: 'delete' }
  | { action: 'fail'; failures: number }

/**
 * Qué se hace con una suscripción después de una vuelta de envíos (puede haber recibido varios avisos
 * juntos; `failures` es cuántas vueltas fallidas traía).
 *
 *   · El servicio dijo que ya no existe: se borra.
 *   · Algo llegó: está sana, la cuenta de fallas vuelve a cero.
 *   · Nada llegó: una falla más (una por vuelta, no una por aviso: un corte de un minuto con la cocina
 *     a pleno no tiene que borrar el teléfono de nadie). A la docena, se borra.
 */
export function subscriptionFate(
  outcomes: readonly PushOutcome[],
  failures: number,
): SubscriptionFate | null {
  if (outcomes.length === 0) return null
  if (outcomes.includes('gone')) return { action: 'delete' }
  if (outcomes.includes('ok')) return { action: 'ok' }
  const next = (Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0) + 1
  return next >= MAX_PUSH_FAILURES ? { action: 'delete' } : { action: 'fail', failures: next }
}
