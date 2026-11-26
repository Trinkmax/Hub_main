/**
 * El protocolo Web Push, a mano y sin dependencias — PURO y testeado (`tests/lib/push-web-push.test.ts`).
 *
 * Tres piezas, cada una con su norma:
 *   · RFC 8291 — el mensaje viaja cifrado para el navegador de destino (ECDH sobre P-256, HKDF y
 *     AES-128-GCM, con la codificación `aes128gcm` de la RFC 8188). El servicio de push lo reparte sin
 *     poder leerlo.
 *   · RFC 8292 (VAPID) — la app firma cada pedido con su par de claves (un JWT ES256), así el servicio
 *     sabe quién manda y solo esa app puede usar la suscripción.
 *   · RFC 8030 — el pedido: un POST al `endpoint` de la suscripción con `TTL`, `Urgency` y `Topic`.
 *
 * Acá no hay red, base ni variables de entorno: se arma el pedido y nada más. Mandarlo es de quien
 * llama. Ningún error nombra una clave ni un endpoint.
 */
import {
  createCipheriv,
  createECDH,
  createHash,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'

const CURVE = 'prime256v1'
const PUBLIC_KEY_BYTES = 65
const PRIVATE_KEY_BYTES = 32
const AUTH_SECRET_BYTES = 16
const SALT_BYTES = 16
/** Un solo registro (RFC 8291 §4), del tamaño que cualquier servicio acepta. */
const RECORD_SIZE = 4096
/** Lo que marca el final del único registro (RFC 8188 §2). */
const LAST_RECORD = 0x02

/**
 * El tope del mensaje sin cifrar. El protocolo aguanta 3993 bytes (4096 menos la cabecera, el
 * delimitador y la etiqueta de AES-GCM); una notificación pesa unos cientos.
 */
export const MAX_PAYLOAD_BYTES = 3072

/** Cuánto vale la firma. La RFC 8292 no deja pasar de 24 h. */
const VAPID_TTL_SECONDS = 12 * 60 * 60
/**
 * Cuánto se reusa una firma ya hecha para el mismo servicio (siempre le quedan al menos 6 h de vida).
 * Apple pide no renovar el JWT más de una vez por hora, y firmar de nuevo en cada envío no suma nada.
 */
const VAPID_REUSE_SECONDS = 6 * 60 * 60
const DEFAULT_TTL_SECONDS = 300

export type VapidKeys = { publicKey: string; privateKey: string }
/** `subject`: a quién escribirle si algo anda mal, `mailto:…` o `https://…` (RFC 8292 §2.1). */
export type VapidDetails = VapidKeys & { subject: string }
/** Las dos claves que el navegador entrega con la suscripción (`PushSubscription.toJSON().keys`). */
export type PushKeys = { p256dh: string; auth: string }
export type PushTarget = PushKeys & { endpoint: string }
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high'
export const PUSH_URGENCIES: readonly PushUrgency[] = ['very-low', 'low', 'normal', 'high']

export type PushRequest = {
  endpoint: string
  headers: Record<string, string>
  body: Uint8Array<ArrayBuffer>
}

function fail(message: string): never {
  throw new Error(`web-push: ${message}`)
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Lee base64url. También acepta base64 común, con o sin relleno: hay quien guarda las claves de la
 * suscripción pasándolas por `btoa`.
 */
function fromBase64Url(value: unknown, what: string): Buffer {
  const text = typeof value === 'string' ? value.trim() : ''
  const normalized = text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) fail(`${what} no está en base64url`)
  return Buffer.from(normalized, 'base64url')
}

/** Un punto de la curva sin comprimir: 0x04 y las dos coordenadas. */
function publicPoint(value: unknown, what: string): Buffer {
  const point = fromBase64Url(value, what)
  if (point.length !== PUBLIC_KEY_BYTES || point[0] !== 0x04) {
    fail(`${what} tiene que ser un punto P-256 sin comprimir (${PUBLIC_KEY_BYTES} bytes)`)
  }
  return point
}

function exactBytes(bytes: Buffer, length: number, what: string): Buffer {
  if (bytes.length !== length) {
    fail(`${what} tiene que medir ${length} bytes (mide ${bytes.length})`)
  }
  return bytes
}

/** El origen del servicio de push: a quién va dirigida la firma. */
function pushOrigin(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    fail('el endpoint no es una dirección válida')
  }
  if (url.protocol !== 'https:') fail('el endpoint tiene que ser https')
  return url.origin
}

/**
 * Un par de claves VAPID nuevo: el punto público sin comprimir (65 bytes) y el número privado
 * (32 bytes), los dos en base64url. La pública es la `applicationServerKey` con la que se anota el
 * navegador; la privada no sale nunca del servidor.
 */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH(CURVE)
  ecdh.generateKeys()
  // Node devuelve el número privado sin los ceros de adelante: 1 de cada 256 veces mide menos de 32.
  const scalar = ecdh.getPrivateKey()
  const privateKey = Buffer.alloc(PRIVATE_KEY_BYTES)
  scalar.copy(privateKey, PRIVATE_KEY_BYTES - scalar.length)
  return { publicKey: toBase64Url(ecdh.getPublicKey()), privateKey: toBase64Url(privateKey) }
}

/**
 * La cabecera `Authorization` de un pedido (RFC 8292 §3): `vapid t=<jwt>, k=<clave pública>`.
 *
 * El JWT va firmado con ES256 (la firma son `r` y `s` pegados, 64 bytes) y dice para qué servicio es
 * (`aud`, el origen del endpoint), hasta cuándo vale (`exp`, 12 h) y a quién avisarle (`sub`).
 */
export function vapidAuthorization(
  endpoint: string,
  vapid: VapidDetails,
  nowSeconds: number = Date.now() / 1000,
): string {
  const audience = pushOrigin(endpoint)
  const subject = typeof vapid.subject === 'string' ? vapid.subject : ''
  if (!/^(mailto:[^\s<>]+@[^\s<>]+|https:\/\/[^\s<>]+)$/.test(subject)) {
    fail('el contacto (sub) tiene que ser mailto:… o https://…, sin espacios')
  }
  if (!Number.isFinite(nowSeconds)) fail('la hora no es un número')

  const publicKey = publicPoint(vapid.publicKey, 'la clave pública VAPID')
  const privateKey = exactBytes(
    fromBase64Url(vapid.privateKey, 'la clave privada VAPID'),
    PRIVATE_KEY_BYTES,
    'la clave privada VAPID',
  )
  const ecdh = createECDH(CURVE)
  try {
    ecdh.setPrivateKey(privateKey)
  } catch {
    fail('la clave privada VAPID no sirve para P-256')
  }
  // Un par mezclado firma igual, y el servicio lo rechaza recién al mandar: mejor saberlo acá.
  if (!ecdh.getPublicKey().equals(publicKey)) {
    fail('la clave pública VAPID no es la de esa clave privada')
  }

  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: toBase64Url(publicKey.subarray(1, 33)),
      y: toBase64Url(publicKey.subarray(33)),
      d: toBase64Url(privateKey),
    },
  })
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(nowSeconds) + VAPID_TTL_SECONDS,
        sub: subject,
      }),
    ),
  )
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${toBase64Url(publicKey)}`
}

/** Las firmas ya hechas, por servicio y par de claves. Son pocas: una por origen de push. */
const signedHeaders = new Map<string, { header: string; signedAt: number }>()
const SIGNED_HEADERS_MAX = 64

function reusableAuthorization(endpoint: string, vapid: VapidDetails, nowSeconds: number): string {
  const id = createHash('sha256')
    .update([pushOrigin(endpoint), vapid.publicKey, vapid.privateKey, vapid.subject].join('\n'))
    .digest('base64url')
  const known = signedHeaders.get(id)
  if (known && nowSeconds >= known.signedAt && nowSeconds - known.signedAt < VAPID_REUSE_SECONDS) {
    return known.header
  }
  const header = vapidAuthorization(endpoint, vapid, nowSeconds)
  if (signedHeaders.size >= SIGNED_HEADERS_MAX) signedHeaders.clear()
  signedHeaders.set(id, { header, signedAt: nowSeconds })
  return header
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, salt, info, length))
}

/**
 * Cifra un mensaje para una suscripción (RFC 8291) y devuelve el cuerpo del pedido, listo para mandar
 * con `Content-Encoding: aes128gcm`: la cabecera de 86 bytes (sal, tamaño de registro y la clave pública
 * de este envío) y, atrás, un único registro cifrado.
 *
 * Cada mensaje usa una sal y un par de claves propios, que se descartan. `overrides` existe solo para
 * que la prueba pueda repetir, byte por byte, el ejemplo de la RFC: nunca se usa al mandar.
 */
export function encryptPayload(
  payload: Uint8Array | string,
  keys: PushKeys,
  overrides: { salt?: Uint8Array; localPrivateKey?: Uint8Array } = {},
): Uint8Array<ArrayBuffer> {
  const plaintext =
    typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload)
  if (plaintext.length === 0) fail('el mensaje está vacío')
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    fail(`el mensaje pesa ${plaintext.length} bytes y el tope es ${MAX_PAYLOAD_BYTES}`)
  }
  const uaPublic = publicPoint(keys.p256dh, 'la clave p256dh')
  const authSecret = exactBytes(
    fromBase64Url(keys.auth, 'el secreto auth'),
    AUTH_SECRET_BYTES,
    'el secreto auth',
  )
  const salt = overrides.salt
    ? exactBytes(Buffer.from(overrides.salt), SALT_BYTES, 'la sal')
    : randomBytes(SALT_BYTES)

  const ecdh = createECDH(CURVE)
  if (overrides.localPrivateKey) {
    const scalar = exactBytes(
      Buffer.from(overrides.localPrivateKey),
      PRIVATE_KEY_BYTES,
      'la clave privada del envío',
    )
    try {
      ecdh.setPrivateKey(scalar)
    } catch {
      fail('la clave privada del envío no sirve para P-256')
    }
  } else {
    ecdh.generateKeys()
  }
  const asPublic = ecdh.getPublicKey()

  let shared: Buffer
  try {
    // También es el control que pide la RFC 8291 §7: el punto del navegador tiene que estar en la curva.
    shared = ecdh.computeSecret(uaPublic)
  } catch {
    fail('la clave p256dh no es un punto de la curva P-256')
  }

  // RFC 8291 §3.4: el secreto compartido y el de la suscripción dan el material de claves…
  const ikm = hkdf(
    authSecret,
    shared,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
    32,
  )
  // …y de ahí, con la sal, salen la clave y el número de único uso (RFC 8188 §2.2 y §2.3).
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const record = Buffer.concat([
    cipher.update(plaintext),
    cipher.update(Buffer.from([LAST_RECORD])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  // RFC 8188 §2.1: sal (16) | tamaño de registro (4) | largo de la clave (1) | clave pública del envío.
  const header = Buffer.alloc(SALT_BYTES + 5)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES)
  header.writeUInt8(asPublic.length, SALT_BYTES + 4)
  return new Uint8Array(Buffer.concat([header, asPublic, record]))
}

/**
 * El tema de un mensaje (RFC 8030 §5.4): si el teléfono estaba sin señal, el mensaje nuevo reemplaza
 * al anterior del mismo tema en vez de llegar los dos. Admite hasta 32 caracteres del alfabeto
 * base64url, así que se deriva con un hash: mismo texto, mismo tema.
 */
export function pushTopic(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url').slice(0, 32)
}

/**
 * El pedido completo para mandarle un mensaje a una suscripción: a dónde, con qué cabeceras y el
 * cuerpo cifrado. Se manda con `fetch(endpoint, { method: 'POST', headers, body })`.
 *
 *   · `ttlSeconds`: cuánto lo guarda el servicio si el teléfono no está (5 minutos si no se dice).
 *   · `urgency`: `high` despierta al teléfono aunque esté ahorrando batería.
 *   · `topic`: cualquier texto; ver `pushTopic`.
 *
 * El cifrado es nuevo en cada pedido. La firma (`Authorization`) no: la de un mismo servicio se reusa
 * por unas horas (ver `VAPID_REUSE_SECONDS`).
 */
export function buildPushRequest(input: {
  subscription: PushTarget
  payload: Uint8Array | string
  vapid: VapidDetails
  ttlSeconds?: number
  urgency?: PushUrgency
  topic?: string
  /** La hora, en segundos. Solo hace falta fijarla en una prueba. */
  nowSeconds?: number
}): PushRequest {
  const { subscription, payload, vapid } = input
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS
  if (!Number.isSafeInteger(ttl) || ttl < 0) fail('el TTL tiene que ser un entero de 0 para arriba')
  const urgency = input.urgency ?? 'normal'
  if (!PUSH_URGENCIES.includes(urgency)) fail('la urgencia no es una de las cuatro que existen')
  const nowSeconds = input.nowSeconds ?? Date.now() / 1000
  if (!Number.isFinite(nowSeconds)) fail('la hora no es un número')

  const headers: Record<string, string> = {
    Authorization: reusableAuthorization(subscription.endpoint, vapid, nowSeconds),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(ttl),
    Urgency: urgency,
  }
  if (input.topic) headers.Topic = pushTopic(input.topic)

  return {
    endpoint: subscription.endpoint,
    headers,
    body: encryptPayload(payload, { p256dh: subscription.p256dh, auth: subscription.auth }),
  }
}

export type PushOutcome = 'ok' | 'gone' | 'failed'

/**
 * Qué quiere decir la respuesta del servicio. 2xx: lo aceptó. 404 o 410: esa suscripción ya no existe
 * (RFC 8030 §7.3; el navegador la dio de baja o venció) y no tiene sentido volver a intentar. Lo demás,
 * o que no haya habido respuesta (`null`), es una falla que puede ser pasajera.
 */
export function pushOutcome(status: number | null): PushOutcome {
  if (status === null) return 'failed'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 404 || status === 410) return 'gone'
  return 'failed'
}
