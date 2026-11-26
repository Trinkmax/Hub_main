/**
 * Las notificaciones push de los avisos de cocina.
 *
 * Arriba, lo puro: qué se le manda al teléfono y qué se anota de cada suscripción. Abajo, el envío de
 * punta a punta (`pushNotices`) con el código de verdad: lo único de mentira es la base y la red. Cada
 * «teléfono» tiene su par de claves y abre lo que le llega, así que si el mensaje no estuviera cifrado
 * para él, o dijera otra cosa, esto se cae. No sale ningún pedido real.
 */

import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => state.client }))

import {
  emptyTally,
  MAX_PUSH_FAILURES,
  noticePush,
  noticeUrl,
  pushesNotice,
  pushResultLabel,
  subscriptionFate,
} from '@/lib/pos/notices/push-payload'
import { noticeText } from '@/lib/pos/notices/text'
import type { NoticeKind, PosNotice } from '@/lib/pos/notices/types'
import { generateVapidKeys, MAX_PAYLOAD_BYTES, pushTopic } from '@/lib/push/web-push'
import { FakeDb, type FakeRow, fakeClient } from './tex-mensajeria-kit'

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222'
const BRANCH = '33333333-3333-4333-8333-333333333333'
const WAITER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_WAITER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SESSION = '0b9f4d7e-55f1-4f0a-9d53-0d6a1f1f3a11'
const STATION = '6a1c2f60-3d1b-4a55-8f43-6f1f9f0a7c22'
const NOTICE = 'c0ffee00-0000-4000-8000-000000000001'
const NOW = new Date('2026-11-27T01:30:00.000Z') // 22:30 en Córdoba

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()
const noticeId = (n: number) => `c0ffee00-0000-4000-8000-${String(n).padStart(12, '0')}`

function notice(overrides: Partial<PosNotice> = {}): PosNotice {
  return {
    id: NOTICE,
    user_id: WAITER,
    session_id: SESSION,
    kind: 'ready',
    station_id: STATION,
    station_name: 'Barra',
    station_kind: 'drink',
    station_icon: null,
    table_label: '12',
    alias: null,
    items: [
      { n: 'Mojito', q: 4 },
      { n: 'Fernet con coca', q: 2 },
    ],
    units: 6,
    created_at: minutesAgo(0),
    ...overrides,
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Lo puro
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('noticePush', () => {
  it('«para retirar» es urgente: despierta al teléfono y se guarda 10 minutos', () => {
    const push = noticePush(notice(), 'hub')
    const text = noticeText(notice())

    expect(push.urgency).toBe('high')
    expect(push.ttlSeconds).toBe(600)
    expect(push.topic).toBe(text.tag)
    expect(push.payload).toEqual({
      v: 1,
      id: NOTICE,
      title: text.title,
      body: text.body,
      tag: `pos:${SESSION}:${STATION}`,
      strong: true,
      vibrate: text.vibrate,
      url: `/hub/salon/mesa/${SESSION}`,
    })
    expect(push.payload.title).toContain('12')
    expect(push.payload.body).toContain('Mojito')
  })

  it.each<NoticeKind>([
    'preparing',
    'not_ready',
  ])('«%s» es informativo: normal y 5 minutos', (kind) => {
    const push = noticePush(notice({ kind }), 'hub')

    expect(push.urgency).toBe('normal')
    expect(push.ttlSeconds).toBe(300)
    expect(push.payload.strong).toBe(false)
    expect(push.payload.title).toBe(noticeText(notice({ kind })).title)
  })

  it('dice lo mismo que el aviso dentro de la app, y usa su misma etiqueta de tema', () => {
    for (const kind of ['ready', 'preparing', 'not_ready'] as const) {
      const one = notice({ kind, table_label: null, alias: 'Los de la barra' })
      const text = noticeText(one)
      const push = noticePush(one, 'hub')
      expect([push.payload.title, push.payload.body, push.payload.tag, push.topic]).toEqual([
        text.title,
        text.body,
        text.tag,
        text.tag,
      ])
    }
  })

  it('un aviso común pesa poco', () => {
    const bytes = Buffer.byteLength(JSON.stringify(noticePush(notice(), 'hub').payload), 'utf8')
    expect(bytes).toBeLessThan(500)
  })

  it('con nombres desmedidos corta el texto, sin partir un emoji, y sigue entrando', () => {
    const huge = notice({
      table_label: '🍕'.repeat(300),
      station_name: 'Estación '.repeat(40),
      items: Array.from({ length: 6 }, (_, i) => ({ n: `${'🍹'.repeat(200)} ${i}`, q: 2 })),
    })
    const { payload } = noticePush(huge, 'un-bar-con-un-nombre-bien-largo')
    const json = JSON.stringify(payload)

    expect(Array.from(payload.title)).toHaveLength(80)
    expect(Array.from(payload.body)).toHaveLength(240)
    expect(payload.title.endsWith('…')).toBe(true)
    expect(payload.body.endsWith('…')).toBe(true)
    // Un emoji partido al medio no sobrevive la ida y vuelta por UTF-8.
    expect(Buffer.from(json, 'utf8').toString('utf8')).toBe(json)
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThan(MAX_PAYLOAD_BYTES)
  })

  it('un texto que ya entra no se toca', () => {
    const title = 'x'.repeat(80)
    const exact = notice({
      table_label: null,
      alias: title.slice(0, 80 - ' · para retirar'.length),
    })
    expect(noticePush(exact, 'hub').payload.title).toBe(noticeText(exact).title)
    expect(noticePush(exact, 'hub').payload.title).not.toContain('…')
  })
})

describe('noticeUrl', () => {
  it('lleva a la mesa en el salón de ese bar', () => {
    expect(noticeUrl('hub', SESSION)).toBe(`/hub/salon/mesa/${SESSION}`)
  })

  it('no deja que un dato raro arme otra dirección', () => {
    expect(noticeUrl('mi bar/../x', 'a b?c#d')).toBe('/mi%20bar%2F..%2Fx/salon/mesa/a%20b%3Fc%23d')
  })
})

describe('pushResultLabel', () => {
  it('es el resumen corto que queda en el aviso', () => {
    expect(pushResultLabel(emptyTally())).toBe('ok:0 gone:0 fail:0 skip:0')
    expect(pushResultLabel({ ok: 2, gone: 0, fail: 1, skip: 0 })).toBe('ok:2 gone:0 fail:1 skip:0')
    expect(pushResultLabel({ ok: 0, gone: 3, fail: 0, skip: 12 })).toBe(
      'ok:0 gone:3 fail:0 skip:12',
    )
  })

  it('cada cuenta arranca en cero y es propia', () => {
    const one = emptyTally()
    one.ok += 1
    expect(emptyTally()).toEqual({ ok: 0, gone: 0, fail: 0, skip: 0 })
  })
})

describe('subscriptionFate', () => {
  it('si el servicio dijo que ya no existe, se borra, haya pasado lo que haya pasado con el resto', () => {
    expect(subscriptionFate(['gone'], 0)).toEqual({ action: 'delete' })
    expect(subscriptionFate(['ok', 'gone'], 3)).toEqual({ action: 'delete' })
    expect(subscriptionFate(['failed', 'gone', 'failed'], 0)).toEqual({ action: 'delete' })
  })

  it('si algo llegó, está sana', () => {
    expect(subscriptionFate(['ok'], 7)).toEqual({ action: 'ok' })
    expect(subscriptionFate(['failed', 'ok'], 11)).toEqual({ action: 'ok' })
  })

  it('si nada llegó, suma una falla por vuelta (no una por aviso)', () => {
    expect(subscriptionFate(['failed'], 0)).toEqual({ action: 'fail', failures: 1 })
    expect(subscriptionFate(['failed', 'failed', 'failed'], 4)).toEqual({
      action: 'fail',
      failures: 5,
    })
  })

  it('a la docena de fallas se da por perdida', () => {
    expect(MAX_PUSH_FAILURES).toBe(12)
    expect(subscriptionFate(['failed'], 10)).toEqual({ action: 'fail', failures: 11 })
    expect(subscriptionFate(['failed'], 11)).toEqual({ action: 'delete' })
    expect(subscriptionFate(['failed'], 40)).toEqual({ action: 'delete' })
  })

  it('una cuenta rota en la base se toma como cero, y sin envíos no hay nada que hacer', () => {
    expect(subscriptionFate(['failed'], Number.NaN)).toEqual({ action: 'fail', failures: 1 })
    expect(subscriptionFate(['failed'], -3)).toEqual({ action: 'fail', failures: 1 })
    expect(subscriptionFate([], 5)).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// El envío de punta a punta
// ───────────────────────────────────────────────────────────────────────────────────────────────
const VAPID = generateVapidKeys()

type Phone = {
  id: string
  endpoint: string
  row: FakeRow
  /** Abre, con la clave privada de este teléfono, lo que le mandaron (RFC 8291, lado del navegador). */
  open: (body: unknown) => unknown
}

let phones = 0
function phone(endpoint: string, overrides: FakeRow = {}): Phone {
  phones += 1
  const id = `5ub5c41b-0000-4000-8000-${String(phones).padStart(12, '0')}`
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  const open = (body: unknown) => {
    const data = Buffer.from(body as Uint8Array)
    const salt = data.subarray(0, 16)
    const asPublic = data.subarray(21, 21 + data.readUInt8(20))
    const record = data.subarray(21 + data.readUInt8(20))
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic])
    const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), auth, info, 32))
    const derive = (label: string, length: number) =>
      Buffer.from(
        hkdfSync('sha256', ikm, salt, Buffer.from(`Content-Encoding: ${label}\0`), length),
      )
    const decipher = createDecipheriv('aes-128-gcm', derive('aes128gcm', 16), derive('nonce', 12))
    decipher.setAuthTag(record.subarray(record.length - 16))
    const padded = Buffer.concat([
      decipher.update(record.subarray(0, record.length - 16)),
      decipher.final(),
    ])
    expect(padded[padded.length - 1]).toBe(0x02)
    return JSON.parse(padded.subarray(0, padded.length - 1).toString('utf8')) as unknown
  }
  return {
    id,
    endpoint,
    open,
    row: {
      id,
      tenant_id: TENANT,
      user_id: WAITER,
      endpoint,
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth_key: auth.toString('base64url'),
      user_agent: 'Mozilla/5.0 (Linux; Android 15) Chrome/142',
      events: ['ready', 'preparing'],
      created_at: minutesAgo(600),
      updated_at: minutesAgo(600),
      last_ok_at: null,
      failures: 0,
      ...overrides,
    },
  }
}

function noticeRow(overrides: FakeRow = {}): FakeRow {
  return {
    ...notice(),
    tenant_id: TENANT,
    branch_id: BRANCH,
    pushed_at: null,
    push_result: null,
    ...overrides,
  }
}

type Call = { url: string; init: RequestInit; headers: Record<string, string> }

let db: FakeDb
let calls: Call[]
/** Qué contesta cada servicio de push. Por defecto, 201: aceptado. */
let respond: (url: string, init: RequestInit) => Response | Promise<Response>
let errors: MockInstance<typeof console.error>

const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input)
  calls.push({ url, init, headers: (init.headers ?? {}) as Record<string, string> })
  return respond(url, init)
})

function seed(input: { notices?: FakeRow[]; phones?: Phone[]; tenants?: FakeRow[] }) {
  db = new FakeDb({
    tenants: input.tenants ?? [
      { id: TENANT, slug: 'hub' },
      { id: OTHER_TENANT, slug: 'el-cerro' },
    ],
    pos_notices: input.notices ?? [noticeRow()],
    push_subscriptions: (input.phones ?? []).map((one) => one.row),
  })
  db.rpcResult = (name) =>
    name === 'push_vapid_keys' ? { public: VAPID.publicKey, private: VAPID.privateKey } : null
  state.client = fakeClient(db, 'service')
}

/** `pushNotices` recién cargado: sin claves recordadas ni firmas reusadas de otra prueba. */
async function load() {
  const { pushNotices } = await import('@/lib/pos/notices/push')
  return pushNotices
}

const noticeIn = (id: string) => db.rows('pos_notices').find((row) => row.id === id)
const subscription = (one: Phone) => db.rows('push_subscriptions').find((row) => row.id === one.id)
const callTo = (one: Phone) => calls.find((call) => call.url === one.endpoint)
const logged = () => JSON.stringify(errors.mock.calls)
const NOTHING = { notices: 0, sent: 0, gone: 0, failed: 0, skipped: 0 }

describe('qué avisos llegan como notificación', () => {
  it('solo «para retirar»', () => {
    expect(pushesNotice('ready')).toBe(true)
    expect(pushesNotice('preparing')).toBe(false)
    expect(pushesNotice('not_ready')).toBe(false)
  })
})

describe('pushNotices', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    vi.stubEnv('EMAIL_FROM', 'HUB! Coffee & Bar <avisos@example.com>')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    calls = []
    respond = () => new Response(null, { status: 201 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('manda el aviso a cada teléfono de quien atiende, cifrado para ese teléfono', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1:APA91b', { failures: 5 })
    const iphone = phone('https://web.push.apple.com/QGmJ-iphone-1')
    const colleague = phone('https://fcm.googleapis.com/fcm/send/otro-mozo', {
      user_id: OTHER_WAITER,
    })
    const otherBar = phone('https://fcm.googleapis.com/fcm/send/otro-bar', {
      tenant_id: OTHER_TENANT,
    })
    seed({ phones: [android, iphone, colleague, otherBar] })

    const result = await (await load())([NOTICE])

    expect(result).toEqual({ notices: 1, sent: 2, gone: 0, failed: 0, skipped: 0 })
    expect(calls.map((call) => call.url).sort()).toEqual([android.endpoint, iphone.endpoint].sort())

    const text = noticeText(notice())
    const expected = {
      v: 1,
      id: NOTICE,
      title: text.title,
      body: text.body,
      tag: text.tag,
      strong: true,
      vibrate: text.vibrate,
      url: `/hub/salon/mesa/${SESSION}`,
    }
    for (const one of [android, iphone]) {
      const call = callTo(one)
      expect(call?.init.method).toBe('POST')
      // Un servicio de push no redirige; si lo hiciera, no se lo sigue.
      expect(call?.init.redirect).toBe('manual')
      expect(call?.init.signal).toBeInstanceOf(AbortSignal)
      expect(call?.headers).toMatchObject({
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '600',
        Urgency: 'high',
        Topic: pushTopic(text.tag),
      })
      // Firmado con el par guardado en la base, para ese servicio.
      const [, jwt = '', key = ''] =
        /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(call?.headers.Authorization ?? '') ?? []
      expect(key).toBe(VAPID.publicKey)
      expect(JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString())).toEqual({
        aud: new URL(one.endpoint).origin,
        exp: Math.floor(NOW.getTime() / 1000) + 12 * 3600,
        sub: 'mailto:avisos@example.com',
      })
      expect(one.open(call?.init.body)).toEqual(expected)
    }
    // Lo que va a un teléfono no lo abre el otro.
    expect(() => iphone.open(callTo(android)?.init.body)).toThrow()

    expect(noticeIn(NOTICE)).toMatchObject({
      pushed_at: NOW.toISOString(),
      push_result: 'ok:2 gone:0 fail:0 skip:0',
    })
    expect(subscription(android)).toMatchObject({ failures: 0, last_ok_at: NOW.toISOString() })
    expect(subscription(iphone)).toMatchObject({ failures: 0, last_ok_at: NOW.toISOString() })
    // Los teléfonos de otra persona y de otro bar ni se enteran.
    expect(subscription(colleague)).toMatchObject({ last_ok_at: null, failures: 0 })
    expect(subscription(otherBar)).toMatchObject({ last_ok_at: null, failures: 0 })
    expect(errors).not.toHaveBeenCalled()
  })

  it('un aviso sale una sola vez, aunque lo pidan repetido, a la vez o de nuevo', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    seed({ phones: [android] })
    const pushNotices = await load()

    const [first, second] = await Promise.all([
      pushNotices([NOTICE, NOTICE]),
      pushNotices([NOTICE]),
    ])
    expect(first.notices + second.notices).toBe(1)
    expect(first.sent + second.sent).toBe(1)
    expect(await pushNotices([NOTICE])).toEqual(NOTHING)
    expect(calls).toHaveLength(1)
  })

  it('un aviso que ya salió, o que no existe, no manda nada', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    seed({
      notices: [noticeRow({ pushed_at: minutesAgo(1), push_result: 'ok:1 gone:0 fail:0 skip:0' })],
      phones: [android],
    })

    expect(await (await load())([NOTICE, noticeId(999)])).toEqual(NOTHING)
    expect(calls).toHaveLength(0)
    expect(noticeIn(NOTICE)).toMatchObject({ pushed_at: minutesAgo(1) })
  })

  it('respeta de qué quiere enterarse cada teléfono', async () => {
    const everything = phone('https://fcm.googleapis.com/fcm/send/todo')
    const onlyReady = phone('https://fcm.googleapis.com/fcm/send/solo-listo', { events: ['ready'] })
    const onlyPreparing = phone('https://fcm.googleapis.com/fcm/send/solo-empezo', {
      events: ['preparing'],
    })
    const nothing = phone('https://fcm.googleapis.com/fcm/send/nada', { events: [] })
    const kinds: NoticeKind[] = ['preparing', 'ready', 'not_ready']
    seed({
      notices: kinds.map((kind, index) => noticeRow({ id: noticeId(index + 1), kind })),
      phones: [everything, onlyReady, onlyPreparing, nothing],
    })

    const result = await (await load())(kinds.map((_, index) => noticeId(index + 1)))

    // Solo «para retirar» sale como notificación (26/11: «si no le van a llegar muchas»).
    expect(result).toEqual({ notices: 3, sent: 2, gone: 0, failed: 0, skipped: 0 })
    const received = (one: Phone) =>
      calls
        .filter((call) => call.url === one.endpoint)
        .map((call) => (one.open(call.init.body) as { id: string }).id)
        .sort()
    expect(received(everything)).toEqual([noticeId(2)])
    expect(received(onlyReady)).toEqual([noticeId(2)])
    // Un teléfono que había quedado anotado solo para «lo empezaron» ya no recibe nada.
    expect(received(onlyPreparing)).toEqual([])
    expect(received(nothing)).toEqual([])
    expect(noticeIn(noticeId(2))).toMatchObject({ push_result: 'ok:2 gone:0 fail:0 skip:0' })
    // Los otros dos quedan reclamados y anotados como «no se manda».
    expect(noticeIn(noticeId(1))).toMatchObject({ pushed_at: NOW.toISOString(), push_result: 'no' })
    expect(noticeIn(noticeId(3))).toMatchObject({ pushed_at: NOW.toISOString(), push_result: 'no' })
  })

  it('lo que no es «para retirar» no sale como notificación', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    seed({
      notices: [
        noticeRow({ id: noticeId(1), kind: 'preparing' }),
        noticeRow({ id: noticeId(2), kind: 'not_ready' }),
      ],
      phones: [android],
    })

    const result = await (await load())([noticeId(1), noticeId(2)])

    expect(result).toEqual({ ...NOTHING, notices: 2 })
    expect(calls).toHaveLength(0)
    // No se lo deja para después: queda reclamado, y el teléfono ni suma una falla.
    expect(noticeIn(noticeId(1))).toMatchObject({ pushed_at: NOW.toISOString(), push_result: 'no' })
    expect(subscription(android)).toMatchObject({ failures: 0 })
  })

  it('si no hay ningún teléfono anotado, el aviso queda reclamado y sin envíos', async () => {
    seed({ phones: [phone('https://fcm.googleapis.com/fcm/send/otro', { user_id: OTHER_WAITER })] })

    expect(await (await load())([NOTICE])).toEqual({ ...NOTHING, notices: 1 })
    expect(calls).toHaveLength(0)
    expect(noticeIn(NOTICE)).toMatchObject({
      pushed_at: NOW.toISOString(),
      push_result: 'ok:0 gone:0 fail:0 skip:0',
    })
  })

  it('borra la suscripción que el servicio da por terminada (404 o 410)', async () => {
    const expired = phone('https://fcm.googleapis.com/fcm/send/vencida')
    const unknown = phone('https://web.push.apple.com/desconocida')
    const alive = phone('https://updates.push.services.mozilla.com/wpush/v2/viva')
    seed({ phones: [expired, unknown, alive] })
    respond = (url) =>
      new Response('{"reason":"Unregistered"}', {
        status: url === expired.endpoint ? 410 : url === unknown.endpoint ? 404 : 201,
      })

    const result = await (await load())([NOTICE])

    expect(result).toEqual({ notices: 1, sent: 1, gone: 2, failed: 0, skipped: 0 })
    expect(subscription(expired)).toBeUndefined()
    expect(subscription(unknown)).toBeUndefined()
    expect(subscription(alive)).toMatchObject({ last_ok_at: NOW.toISOString() })
    expect(noticeIn(NOTICE)).toMatchObject({ push_result: 'ok:1 gone:2 fail:0 skip:0' })
    // Una baja no es un error: no ensucia el log.
    expect(errors).not.toHaveBeenCalled()
  })

  it('una falla suma una, una sola por vuelta, y a la docena se borra', async () => {
    const flaky = phone('https://fcm.googleapis.com/fcm/send/con-fallas', { failures: 3 })
    const offline = phone('https://web.push.apple.com/sin-red', { failures: 0 })
    const lost = phone('https://updates.push.services.mozilla.com/wpush/v2/perdida', {
      failures: 11,
      last_ok_at: minutesAgo(9000),
    })
    seed({
      notices: [noticeRow({ id: noticeId(1) }), noticeRow({ id: noticeId(2) })],
      phones: [flaky, offline, lost],
    })
    respond = (url) => {
      if (url === offline.endpoint) throw new TypeError('fetch failed')
      return new Response('Internal Server Error', { status: url === flaky.endpoint ? 500 : 403 })
    }

    const result = await (await load())([noticeId(1), noticeId(2)])

    expect(result).toEqual({ notices: 2, sent: 0, gone: 0, failed: 6, skipped: 0 })
    expect(subscription(flaky)).toMatchObject({ failures: 4, last_ok_at: null })
    expect(subscription(offline)).toMatchObject({ failures: 1, last_ok_at: null })
    expect(subscription(lost)).toBeUndefined()
    expect(noticeIn(noticeId(1))).toMatchObject({ push_result: 'ok:0 gone:0 fail:3 skip:0' })
    expect(noticeIn(noticeId(2))).toMatchObject({ push_result: 'ok:0 gone:0 fail:3 skip:0' })
  })

  it('si de dos avisos juntos uno llegó, el teléfono está sano', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1', { failures: 9 })
    seed({
      notices: [noticeRow({ id: noticeId(1) }), noticeRow({ id: noticeId(2) })],
      phones: [android],
    })
    let answered = 0
    respond = () => {
      answered += 1
      return new Response(null, { status: answered === 1 ? 503 : 201 })
    }

    const result = await (await load())([noticeId(1), noticeId(2)])

    expect(result).toEqual({ notices: 2, sent: 1, gone: 0, failed: 1, skipped: 0 })
    expect(subscription(android)).toMatchObject({ failures: 0, last_ok_at: NOW.toISOString() })
  })

  it('una redirección no se sigue: cuenta como falla', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    seed({ phones: [android] })
    respond = () =>
      new Response(null, { status: 302, headers: { Location: 'https://10.0.0.5/interno' } })

    expect(await (await load())([NOTICE])).toEqual({ ...NOTHING, notices: 1, failed: 1 })
    expect(calls).toHaveLength(1)
    expect(subscription(android)).toMatchObject({ failures: 1 })
  })

  it('no espera más de 8 segundos a un servicio que no contesta', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/colgado')
    seed({ phones: [android] })
    respond = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        )
      })
    const pushNotices = await load()
    vi.useFakeTimers({ now: NOW })

    let settled = false
    const pending = pushNotices([NOTICE]).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(7_999)
    expect(calls).toHaveLength(1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ ...NOTHING, notices: 1, failed: 1 })
    expect(subscription(android)).toMatchObject({ failures: 1 })
    expect(logged()).toContain('sin respuesta')
  })

  it('no le pega a un endpoint que no es de un servicio de push', async () => {
    const internal = phone('https://10.0.0.5/push')
    const lookalike = phone('https://fcm.googleapis.com.evil.test/fcm/send/abc')
    const plain = phone('http://fcm.googleapis.com/fcm/send/abc')
    const real = phone('https://fcm.googleapis.com/fcm/send/de-verdad')
    seed({ phones: [internal, lookalike, plain, real] })

    const result = await (await load())([NOTICE])

    expect(result).toEqual({ notices: 1, sent: 1, gone: 0, failed: 0, skipped: 3 })
    expect(calls.map((call) => call.url)).toEqual([real.endpoint])
    expect(noticeIn(NOTICE)).toMatchObject({ push_result: 'ok:1 gone:0 fail:0 skip:3' })
    // Ni se le manda ni se la toca.
    for (const one of [internal, lookalike, plain]) {
      expect(subscription(one)).toMatchObject({ failures: 0, last_ok_at: null })
    }
    // Queda a la vista, con la cantidad y nada más.
    expect(errors.mock.calls).toEqual([['[pos.push] avisos:1 ok:1 gone:0 fail:0 skip:3', {}]])
  })

  it('una suscripción con las claves rotas falla sola, sin frenar a las demás', async () => {
    const broken = phone('https://fcm.googleapis.com/fcm/send/rota', { p256dh: 'AAAA' })
    const fine = phone('https://fcm.googleapis.com/fcm/send/sana')
    seed({ phones: [broken, fine] })

    const result = await (await load())([NOTICE])

    expect(result).toEqual({ notices: 1, sent: 1, gone: 0, failed: 1, skipped: 0 })
    expect(calls.map((call) => call.url)).toEqual([fine.endpoint])
    expect(subscription(broken)).toMatchObject({ failures: 1 })
    expect(subscription(fine)).toMatchObject({ failures: 0, last_ok_at: NOW.toISOString() })
  })

  it('en el log van cantidades y códigos, nunca un endpoint, una clave ni un nombre', async () => {
    const flaky = phone('https://fcm.googleapis.com/fcm/send/SECRETO-DEL-ENDPOINT')
    const offline = phone('https://web.push.apple.com/OTRO-SECRETO')
    const internal = phone('https://10.0.0.5/push')
    seed({
      notices: [noticeRow({ alias: 'Mesa de Ignacio', table_label: null })],
      phones: [flaky, offline, internal],
    })
    respond = (url) => {
      if (url === offline.endpoint) throw new TypeError(`fetch failed: ${url}`)
      return new Response('nope', { status: 403 })
    }

    await (await load())([NOTICE])

    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls[0]?.[0]).toBe('[pos.push] avisos:1 ok:0 gone:0 fail:2 skip:1')
    expect(errors.mock.calls[0]?.[1]).toEqual({ '403': 1, 'sin respuesta': 1 })
    const text = logged()
    for (const secret of [
      'SECRETO',
      'googleapis',
      'apple',
      '10.0.0.5',
      'Ignacio',
      'Mojito',
      'avisos@example.com',
      WAITER,
      VAPID.privateKey,
      String(flaky.row.p256dh),
      String(flaky.row.auth_key),
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('con avisos de dos mozos en la misma llamada, a cada uno le llega solo el suyo', async () => {
    const mine = phone('https://fcm.googleapis.com/fcm/send/el-mio')
    const theirs = phone('https://fcm.googleapis.com/fcm/send/el-del-otro', {
      user_id: OTHER_WAITER,
    })
    seed({
      notices: [
        noticeRow({ id: noticeId(1) }),
        noticeRow({ id: noticeId(2), user_id: OTHER_WAITER, table_label: '7' }),
      ],
      phones: [mine, theirs],
    })

    const result = await (await load())([noticeId(1), noticeId(2)])

    expect(result).toEqual({ notices: 2, sent: 2, gone: 0, failed: 0, skipped: 0 })
    expect(calls).toHaveLength(2)
    expect(mine.open(callTo(mine)?.init.body)).toMatchObject({ id: noticeId(1) })
    expect(theirs.open(callTo(theirs)?.init.body)).toMatchObject({ id: noticeId(2) })
  })

  it('cada aviso lleva a la mesa en su bar, con las suscripciones de ese bar', async () => {
    const inHub = phone('https://fcm.googleapis.com/fcm/send/en-hub')
    const inCerro = phone('https://fcm.googleapis.com/fcm/send/en-el-cerro', {
      tenant_id: OTHER_TENANT,
    })
    const otherSession = 'd3b07384-d9a0-4c7e-8b5a-1f2e3d4c5b6a'
    seed({
      notices: [
        noticeRow({ id: noticeId(1) }),
        noticeRow({ id: noticeId(2), tenant_id: OTHER_TENANT, session_id: otherSession }),
      ],
      phones: [inHub, inCerro],
    })

    const result = await (await load())([noticeId(1), noticeId(2)])

    expect(result).toEqual({ notices: 2, sent: 2, gone: 0, failed: 0, skipped: 0 })
    expect(inHub.open(callTo(inHub)?.init.body)).toMatchObject({
      id: noticeId(1),
      url: `/hub/salon/mesa/${SESSION}`,
    })
    expect(inCerro.open(callTo(inCerro)?.init.body)).toMatchObject({
      id: noticeId(2),
      url: `/el-cerro/salon/mesa/${otherSession}`,
    })
    expect(calls).toHaveLength(2)
  })

  it('sin ids barre lo reciente que quedó sin mandar: 3 minutos y hasta 50', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    const recent = Array.from({ length: 55 }, (_, index) =>
      noticeRow({ id: noticeId(index + 1), created_at: minutesAgo(2 - index / 100) }),
    )
    seed({
      notices: [
        ...recent,
        noticeRow({ id: noticeId(900), created_at: minutesAgo(4) }),
        noticeRow({ id: noticeId(901), created_at: minutesAgo(1), pushed_at: minutesAgo(1) }),
      ],
      phones: [android],
    })
    const pushNotices = await load()

    expect(await pushNotices(null)).toEqual({ ...NOTHING, notices: 50, sent: 50 })
    // Los más viejos primero; el que pasó los 3 minutos ya no se manda.
    expect(noticeIn(noticeId(1))).toMatchObject({ pushed_at: NOW.toISOString() })
    expect(noticeIn(noticeId(50))).toMatchObject({ pushed_at: NOW.toISOString() })
    expect(noticeIn(noticeId(51))).toMatchObject({ pushed_at: null })
    expect(noticeIn(noticeId(900))).toMatchObject({ pushed_at: null, push_result: null })
    expect(noticeIn(noticeId(901))).toMatchObject({ pushed_at: minutesAgo(1) })

    // Una lista vacía es lo mismo que no mandar ninguna: la próxima barrida toma los que faltaban.
    expect(await pushNotices([])).toEqual({ ...NOTHING, notices: 5, sent: 5 })
    expect(await pushNotices(null)).toEqual(NOTHING)
    expect(calls).toHaveLength(55)
  })

  it('con muchos avisos trabaja de a tandas y los manda todos', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    const ids = Array.from({ length: 150 }, (_, index) => noticeId(index + 1))
    seed({ notices: ids.map((id) => noticeRow({ id })), phones: [android] })

    expect(await (await load())(ids)).toEqual({ ...NOTHING, notices: 150, sent: 150 })
    expect(calls).toHaveLength(150)
    const claims = db.writes.filter(
      (write) =>
        write.table === 'pos_notices' && 'pushed_at' in (write.payload as Record<string, unknown>),
    )
    expect(claims).toHaveLength(2)
    expect(
      db.rows('pos_notices').every((row) => row.push_result === 'ok:1 gone:0 fail:0 skip:0'),
    ).toBe(true)
  })

  it('no manda más de 10 pedidos a la vez', async () => {
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    const ids = Array.from({ length: 35 }, (_, index) => noticeId(index + 1))
    seed({ notices: ids.map((id) => noticeRow({ id })), phones: [android] })
    let flying = 0
    let most = 0
    respond = async () => {
      flying += 1
      most = Math.max(most, flying)
      await new Promise((resolve) => setTimeout(resolve, 2))
      flying -= 1
      return new Response(null, { status: 201 })
    }

    expect(await (await load())(ids)).toEqual({ ...NOTHING, notices: 35, sent: 35 })
    expect(most).toBe(10)
  })

  it('de vez en cuando borra los avisos de más de una semana, y solo esos', async () => {
    const old = noticeRow({
      id: noticeId(700),
      created_at: minutesAgo(8 * 24 * 60),
      pushed_at: minutesAgo(8 * 24 * 60),
    })
    const lastWeek = noticeRow({
      id: noticeId(701),
      created_at: minutesAgo(6 * 24 * 60),
      pushed_at: minutesAgo(6 * 24 * 60),
    })
    seed({ notices: [noticeRow(), old, lastWeek] })
    const pushNotices = await load()

    // 39 de cada 40 llamadas no limpian nada.
    await pushNotices([NOTICE])
    expect(noticeIn(noticeId(700))).toBeDefined()

    vi.mocked(Math.random).mockReturnValue(0.01)
    expect(await pushNotices(null)).toEqual(NOTHING)
    expect(noticeIn(noticeId(700))).toBeUndefined()
    expect(noticeIn(noticeId(701))).toBeDefined()
    expect(noticeIn(NOTICE)).toBeDefined()
  })

  it('sin configuración para firmar falla ANTES de reclamar: el aviso no se quema', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    const android = phone('https://fcm.googleapis.com/fcm/send/android-1')
    seed({ phones: [android] })

    await expect((await load())([NOTICE])).rejects.toThrow(/EMAIL_FROM/)
    expect(noticeIn(NOTICE)).toMatchObject({ pushed_at: null })
    expect(calls).toHaveLength(0)
    expect(db.writes).toHaveLength(0)
  })

  it('si la base no deja reclamar, falla sin mandar nada', async () => {
    seed({ phones: [phone('https://fcm.googleapis.com/fcm/send/android-1')] })
    db.failing.add('pos_notices')
    const pushNotices = await load()

    await expect(pushNotices([NOTICE])).rejects.toThrow(/pos_notices/)
    await expect(pushNotices(null)).rejects.toThrow(/pos_notices/)
    expect(calls).toHaveLength(0)
  })

  it('si no se pueden leer las suscripciones, no manda y lo deja anotado en el aviso', async () => {
    seed({ phones: [phone('https://fcm.googleapis.com/fcm/send/android-1')] })
    db.failing.add('push_subscriptions')

    expect(await (await load())([NOTICE])).toEqual({ ...NOTHING, notices: 1 })
    expect(calls).toHaveLength(0)
    expect(noticeIn(NOTICE)).toMatchObject({ pushed_at: NOW.toISOString(), push_result: 'error' })
    expect(logged()).toContain('XX000')
  })

  it('un bar que ya no existe no frena los avisos de los demás', async () => {
    const inHub = phone('https://fcm.googleapis.com/fcm/send/en-hub')
    const orphan = phone('https://fcm.googleapis.com/fcm/send/sin-bar', { tenant_id: OTHER_TENANT })
    seed({
      tenants: [{ id: TENANT, slug: 'hub' }],
      notices: [
        noticeRow({ id: noticeId(1), tenant_id: OTHER_TENANT }),
        noticeRow({ id: noticeId(2) }),
      ],
      phones: [inHub, orphan],
    })

    expect(await (await load())([noticeId(1), noticeId(2)])).toEqual({
      ...NOTHING,
      notices: 2,
      sent: 1,
    })
    expect(calls.map((call) => call.url)).toEqual([inHub.endpoint])
    expect(noticeIn(noticeId(1))).toMatchObject({ push_result: 'error' })
    expect(noticeIn(noticeId(2))).toMatchObject({ push_result: 'ok:1 gone:0 fail:0 skip:0' })
  })
})
