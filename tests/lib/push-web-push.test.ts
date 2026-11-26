import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPushRequest,
  encryptPayload,
  generateVapidKeys,
  MAX_PAYLOAD_BYTES,
  type PushKeys,
  pushOutcome,
  pushTopic,
  type VapidDetails,
  vapidAuthorization,
} from '@/lib/push/web-push'

/** Las RFC parten los valores en renglones: acá se copian tal cual y se les sacan los espacios. */
const b64 = (text: string): Buffer => Buffer.from(text.replace(/\s+/g, ''), 'base64url')
const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest()

/**
 * Lo que hace el navegador al recibir (RFC 8291 §3.4), escrito con los HMAC del pseudocódigo de la
 * RFC y no con la función que usa la app: si las dos cuentas dan lo mismo, no es por compartir código.
 */
function receive(body: Uint8Array, uaPrivateKey: Buffer, authSecret: Buffer) {
  const data = Buffer.from(body)
  const salt = data.subarray(0, 16)
  const recordSize = data.readUInt32BE(16)
  const idLength = data.readUInt8(20)
  const asPublic = data.subarray(21, 21 + idLength)
  const record = data.subarray(21 + idLength)

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaPrivateKey)
  const uaPublic = ecdh.getPublicKey()
  const ecdhSecret = ecdh.computeSecret(asPublic)

  const prkKey = hmac(authSecret, ecdhSecret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]))
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)

  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(record.subarray(record.length - 16))
  const padded = Buffer.concat([
    decipher.update(record.subarray(0, record.length - 16)),
    decipher.final(),
  ])
  // El relleno: ceros al final y, antes, el delimitador, que en el único registro tiene que ser 0x02.
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end -= 1
  return {
    recordSize,
    idLength,
    asPublic,
    delimiter: padded[end],
    plaintext: padded.subarray(0, Math.max(end, 0)),
  }
}

/** Un navegador de mentira: su par de claves y su secreto, como los entrega `PushSubscription`. */
function browser() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const privateKey = Buffer.alloc(32)
  const scalar = ecdh.getPrivateKey()
  scalar.copy(privateKey, 32 - scalar.length)
  const auth = randomBytes(16)
  const keys: PushKeys = {
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: auth.toString('base64url'),
  }
  return { keys, privateKey, auth, publicKey: ecdh.getPublicKey() }
}

/** Abre una cabecera `Authorization: vapid …` y dice si la firma es de la clave que trae. */
function readVapid(header: string) {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  const [head = '', claims = '', signature = '', key = ''] = match ? match.slice(1) : []
  const point = Buffer.from(key, 'base64url')
  const publicKey = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
  })
  const signed = Buffer.from(`${head}.${claims}`)
  const check = (data: Buffer) =>
    verify(
      'sha256',
      data,
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    )
  return {
    matched: match !== null,
    header: JSON.parse(Buffer.from(head, 'base64url').toString('utf8') || 'null') as unknown,
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString('utf8') || 'null') as {
      aud: string
      exp: number
      sub: string
    },
    key,
    signatureBytes: Buffer.from(signature, 'base64url').length,
    verified: check(signed),
    verifiedIfChanged: check(Buffer.from(`${head}.${claims}x`)),
  }
}

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv'
const NOW = 1_795_000_000 // segundos; noviembre de 2026

// ───────────────────────────────────────────────────────────────────────────────────────────────
// RFC 8291, sección 5 y apéndice A: el ejemplo completo, con los valores intermedios.
// https://www.rfc-editor.org/rfc/rfc8291.txt
// ───────────────────────────────────────────────────────────────────────────────────────────────
const RFC8291 = {
  text: 'When I grow up, I want to be a watermelon',
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: `BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg
             Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`,
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: `BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-
             JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`,
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  // «an 86-octet header of»
  header: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
           mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8`,
  // «encrypted with AES-GCM, which emits ciphertext of»
  ciphertext: `8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs
               bI_0LpXMuGvnzQ`,
  // El cuerpo del pedido de la sección 5.
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
         mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
         pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
} as const

const rfcKeys: PushKeys = {
  p256dh: RFC8291.uaPublic.replace(/\s+/g, ''),
  auth: RFC8291.auth,
}
const rfcOverrides = { salt: b64(RFC8291.salt), localPrivateKey: b64(RFC8291.asPrivate) }

describe('encryptPayload — el ejemplo de la RFC 8291', () => {
  it('el ejemplo está bien copiado: el texto, y la cabecera más el cifrado dan el cuerpo', () => {
    expect(b64(RFC8291.plaintext).toString('utf8')).toBe(RFC8291.text)
    expect(b64(RFC8291.header)).toHaveLength(86)
    expect(Buffer.concat([b64(RFC8291.header), b64(RFC8291.ciphertext)])).toEqual(b64(RFC8291.body))
  })

  it('da, byte por byte, el cuerpo que publica la RFC', () => {
    const body = encryptPayload(RFC8291.text, rfcKeys, rfcOverrides)

    expect(Buffer.from(body).toString('base64url')).toBe(RFC8291.body.replace(/\s+/g, ''))
    expect(Buffer.from(body.subarray(0, 86))).toEqual(b64(RFC8291.header))
    expect(Buffer.from(body.subarray(86))).toEqual(b64(RFC8291.ciphertext))
    expect(body).toHaveLength(144)
  })

  it('da lo mismo si el mensaje llega en bytes', () => {
    const body = encryptPayload(new Uint8Array(b64(RFC8291.plaintext)), rfcKeys, rfcOverrides)
    expect(Buffer.from(body)).toEqual(b64(RFC8291.body))
  })

  it('devuelve bytes propios, del tamaño justo (no una ventana sobre memoria compartida)', () => {
    const body = encryptPayload(RFC8291.text, rfcKeys, rfcOverrides)
    expect(body).toBeInstanceOf(Uint8Array)
    expect(body.byteOffset).toBe(0)
    expect(body.buffer.byteLength).toBe(body.length)
  })

  it('el navegador de la RFC, con su clave privada, lee el mensaje', () => {
    const body = encryptPayload(RFC8291.text, rfcKeys, rfcOverrides)
    const opened = receive(body, b64(RFC8291.uaPrivate), b64(RFC8291.auth))

    expect(opened.plaintext.toString('utf8')).toBe(RFC8291.text)
    expect(opened.delimiter).toBe(0x02)
    expect(opened.recordSize).toBe(4096)
    expect(opened.asPublic).toEqual(b64(RFC8291.asPublic))
  })
})

describe('encryptPayload — ida y vuelta con claves nuevas', () => {
  const message = JSON.stringify({
    v: 1,
    title: 'Mesa 12 · para retirar',
    body: '🍹 Barra: 4 Mojito · 2 Fernet con coca · y 3 más',
  })

  it('lo que cifra la app lo abre el navegador de destino', () => {
    const phone = browser()
    const body = encryptPayload(message, phone.keys)
    const opened = receive(body, phone.privateKey, phone.auth)

    expect(opened.plaintext.toString('utf8')).toBe(message)
    expect(opened.delimiter).toBe(0x02)
  })

  it('arma la cabecera de la RFC 8188: registro de 4096 y la clave pública del envío', () => {
    const phone = browser()
    const body = encryptPayload(message, phone.keys)
    const opened = receive(body, phone.privateKey, phone.auth)
    const bytes = Buffer.byteLength(message, 'utf8')

    expect(opened.recordSize).toBe(4096)
    expect(opened.idLength).toBe(65)
    expect(opened.asPublic[0]).toBe(0x04)
    // cabecera (86) + mensaje + delimitador (1) + etiqueta de AES-GCM (16)
    expect(body).toHaveLength(86 + bytes + 1 + 16)
  })

  it('cada envío usa su sal y su par de claves: el mismo mensaje nunca sale igual', () => {
    const phone = browser()
    const one = Buffer.from(encryptPayload(message, phone.keys))
    const two = Buffer.from(encryptPayload(message, phone.keys))

    expect(one.subarray(0, 16)).not.toEqual(two.subarray(0, 16))
    expect(one.subarray(21, 86)).not.toEqual(two.subarray(21, 86))
    expect(one.subarray(86)).not.toEqual(two.subarray(86))
    expect(receive(two, phone.privateKey, phone.auth).plaintext.toString('utf8')).toBe(message)
  })

  it('otro navegador no lo abre, y con otro secreto tampoco', () => {
    const phone = browser()
    const other = browser()
    const body = encryptPayload(message, phone.keys)

    expect(() => receive(body, other.privateKey, phone.auth)).toThrow()
    expect(() => receive(body, phone.privateKey, other.auth)).toThrow()
  })

  it('si en el camino cambia un byte, no abre', () => {
    const phone = browser()
    const body = Buffer.from(encryptPayload(message, phone.keys))
    body[body.length - 20] = (body[body.length - 20] ?? 0) ^ 0x01

    expect(() => receive(body, phone.privateKey, phone.auth)).toThrow()
  })

  it('acepta las claves en base64 común, con relleno, como salen de `btoa`', () => {
    const phone = browser()
    const body = encryptPayload(message, {
      p256dh: phone.publicKey.toString('base64'),
      auth: phone.auth.toString('base64'),
    })
    expect(receive(body, phone.privateKey, phone.auth).plaintext.toString('utf8')).toBe(message)
  })

  it('entra justo el mensaje más grande que se permite', () => {
    const phone = browser()
    const big = 'x'.repeat(MAX_PAYLOAD_BYTES)
    const body = encryptPayload(big, phone.keys)

    // Con todo, queda por debajo de los 4096 bytes que cualquier servicio está obligado a aceptar.
    expect(body.length).toBeLessThanOrEqual(4096)
    expect(receive(body, phone.privateKey, phone.auth).plaintext.toString('utf8')).toBe(big)
  })
})

describe('encryptPayload — lo que no acepta', () => {
  const phone = browser()

  it('un mensaje vacío', () => {
    expect(() => encryptPayload('', phone.keys)).toThrow(/vacío/)
    expect(() => encryptPayload(new Uint8Array(0), phone.keys)).toThrow(/vacío/)
  })

  it('un mensaje más grande que el tope (contado en bytes, no en letras)', () => {
    expect(() => encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES + 1), phone.keys)).toThrow(/tope/)
    // 1100 emojis son 4400 bytes.
    expect(() => encryptPayload('🍕'.repeat(1100), phone.keys)).toThrow(/tope/)
  })

  it('una clave p256dh que no mide 65 bytes o no es un punto sin comprimir', () => {
    const short = phone.publicKey.subarray(0, 64).toString('base64url')
    const compressed = createECDH('prime256v1').generateKeys('base64url', 'compressed')
    const wrongPrefix = Buffer.from(phone.publicKey)
    wrongPrefix[0] = 0x05

    expect(() => encryptPayload('hola', { ...phone.keys, p256dh: short })).toThrow(/p256dh/)
    expect(() => encryptPayload('hola', { ...phone.keys, p256dh: compressed })).toThrow(/p256dh/)
    expect(() =>
      encryptPayload('hola', { ...phone.keys, p256dh: wrongPrefix.toString('base64url') }),
    ).toThrow(/p256dh/)
  })

  it('un punto válido pero en la forma «híbrida»: OpenSSL lo acepta, el navegador no lo abriría', () => {
    // Mismo punto y mismos 65 bytes, con otro primer byte (0x06 o 0x07). Como las claves públicas
    // entran tal cual en la derivación, cifrar con esa forma daría un mensaje que nadie puede abrir.
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const hybrid = ecdh.getPublicKey('base64url', 'hybrid')
    expect(Buffer.from(hybrid, 'base64url')).toHaveLength(65)

    expect(() => encryptPayload('hola', { ...phone.keys, p256dh: hybrid })).toThrow(/sin comprimir/)
  })

  it('una clave p256dh que no está en la curva (RFC 8291 §7)', () => {
    const offCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0x01)])
    expect(() =>
      encryptPayload('hola', { ...phone.keys, p256dh: offCurve.toString('base64url') }),
    ).toThrow(/curva/)
  })

  it('un secreto auth que no mide 16 bytes', () => {
    const short = randomBytes(12).toString('base64url')
    const long = randomBytes(32).toString('base64url')
    expect(() => encryptPayload('hola', { ...phone.keys, auth: short })).toThrow(/auth/)
    expect(() => encryptPayload('hola', { ...phone.keys, auth: long })).toThrow(/auth/)
  })

  it('claves que no son base64url', () => {
    expect(() => encryptPayload('hola', { ...phone.keys, p256dh: 'no es base64 ***' })).toThrow(
      /base64url/,
    )
    expect(() => encryptPayload('hola', { ...phone.keys, auth: '' })).toThrow(/base64url/)
    expect(() =>
      encryptPayload('hola', { p256dh: undefined, auth: null } as unknown as PushKeys),
    ).toThrow(/base64url/)
  })

  it('una sal o una clave del envío del tamaño equivocado, o que no sirve para la curva', () => {
    expect(() => encryptPayload('hola', phone.keys, { salt: randomBytes(15) })).toThrow(/sal/)
    expect(() => encryptPayload('hola', phone.keys, { localPrivateKey: randomBytes(31) })).toThrow(
      /clave privada del envío/,
    )
    expect(() => encryptPayload('hola', phone.keys, { localPrivateKey: Buffer.alloc(32) })).toThrow(
      /P-256/,
    )
  })

  it('ningún error repite una clave', () => {
    const bad = { p256dh: phone.keys.p256dh.slice(0, 60), auth: phone.keys.auth }
    let message = ''
    try {
      encryptPayload('hola', bad)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^web-push: /)
    expect(message).not.toContain(bad.p256dh)
    expect(message).not.toContain(bad.auth)
  })
})

describe('generateVapidKeys', () => {
  it('da el punto público sin comprimir (65 bytes) y el número privado (32 bytes), en base64url', () => {
    const { publicKey, privateKey } = generateVapidKeys()

    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65)
    expect(Buffer.from(publicKey, 'base64url')[0]).toBe(0x04)
    expect(Buffer.from(privateKey, 'base64url')).toHaveLength(32)
  })

  it('las dos mitades son del mismo par, y cada llamada da uno distinto', () => {
    const one = generateVapidKeys()
    const two = generateVapidKeys()
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(one.privateKey, 'base64url'))

    expect(ecdh.getPublicKey().toString('base64url')).toBe(one.publicKey)
    expect(two.publicKey).not.toBe(one.publicKey)
    expect(two.privateKey).not.toBe(one.privateKey)
  })

  it('la privada mide siempre 32 bytes, también cuando el número empieza con ceros', () => {
    // 1 de cada 256 números empieza con un byte en cero y Node lo entrega más corto: en 3000 pares
    // aparecen una decena. Todos tienen que entrar en lo que valida `push_vapid_init` (40 a 50 y 80
    // a 100 caracteres).
    const lengths = new Set<string>()
    for (let i = 0; i < 3000; i += 1) {
      const { publicKey, privateKey } = generateVapidKeys()
      lengths.add(`${publicKey.length}/${privateKey.length}`)
    }
    expect([...lengths]).toEqual(['87/43'])
  })
})

describe('vapidAuthorization (RFC 8292)', () => {
  const keys = generateVapidKeys()
  const vapid: VapidDetails = { ...keys, subject: 'mailto:avisos@example.com' }

  it('el ejemplo de la RFC verifica con su clave: así se controlan las firmas de acá abajo', () => {
    const example = readVapid(
      `vapid t=${[
        'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3',
        'B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1ha',
        'Wx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_H',
        'LGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA',
      ].join('')}, k=${[
        'BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dR',
        'uU_RCPCfA5aq9ojSwk5Y2EmClBPs',
      ].join('')}`,
    )

    expect(example.verified).toBe(true)
    expect(example.verifiedIfChanged).toBe(false)
    expect(example.header).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(example.claims).toEqual({
      aud: 'https://push.example.net',
      exp: 1453523768,
      sub: 'mailto:push@example.com',
    })
  })

  it('tiene la forma `vapid t=<jwt>, k=<clave pública>` y la firma es de esa clave', () => {
    const read = readVapid(vapidAuthorization(ENDPOINT, vapid, NOW))

    expect(read.matched).toBe(true)
    expect(read.key).toBe(keys.publicKey)
    expect(read.header).toEqual({ typ: 'JWT', alg: 'ES256' })
    // ES256 en un JWT: `r` y `s` pegados (64 bytes), no la forma DER que da OpenSSL si no se le pide.
    expect(read.signatureBytes).toBe(64)
    expect(read.verified).toBe(true)
    expect(read.verifiedIfChanged).toBe(false)
  })

  it('dice para qué servicio es (el origen del endpoint), hasta cuándo y de quién', () => {
    const { claims } = readVapid(vapidAuthorization(ENDPOINT, vapid, NOW))

    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: NOW + 12 * 60 * 60,
      sub: 'mailto:avisos@example.com',
    })
  })

  it('el origen no arrastra camino, consulta ni el puerto de siempre', () => {
    const aud = (endpoint: string) => readVapid(vapidAuthorization(endpoint, vapid, NOW)).claims.aud

    expect(aud('https://web.push.apple.com/QGmJxyz')).toBe('https://web.push.apple.com')
    expect(aud('https://wns2-by3p.notify.windows.com/w/?token=AwYAAAD%2b')).toBe(
      'https://wns2-by3p.notify.windows.com',
    )
    expect(aud('https://updates.push.services.mozilla.com:443/wpush/v2/gAAAA')).toBe(
      'https://updates.push.services.mozilla.com',
    )
  })

  it('sin hora dada usa la de ahora, y nunca vale más de 24 horas', () => {
    const before = Math.floor(Date.now() / 1000)
    const { claims } = readVapid(vapidAuthorization(ENDPOINT, vapid))
    const after = Math.floor(Date.now() / 1000)

    expect(claims.exp).toBeGreaterThanOrEqual(before + 12 * 60 * 60)
    expect(claims.exp).toBeLessThanOrEqual(after + 12 * 60 * 60)
    expect(claims.exp - after).toBeLessThanOrEqual(24 * 60 * 60)
    expect(Number.isInteger(claims.exp)).toBe(true)
  })

  it('acepta una dirección https como contacto', () => {
    const read = readVapid(
      vapidAuthorization(ENDPOINT, { ...keys, subject: 'https://app.example.com' }, NOW),
    )
    expect(read.verified).toBe(true)
    expect(read.claims.sub).toBe('https://app.example.com')
  })

  it('una firma hecha con otra clave no pasa por la de este par', () => {
    const other = generateVapidKeys()
    const header = vapidAuthorization(ENDPOINT, { ...other, subject: vapid.subject }, NOW)
    const swapped = header.replace(/k=.*$/, `k=${keys.publicKey}`)

    expect(readVapid(header).verified).toBe(true)
    expect(readVapid(swapped).verified).toBe(false)
  })

  it('no firma para un endpoint que no es https o no es una dirección', () => {
    expect(() => vapidAuthorization('http://fcm.googleapis.com/fcm/send/x', vapid, NOW)).toThrow(
      /https/,
    )
    expect(() => vapidAuthorization('no es una dirección', vapid, NOW)).toThrow(/endpoint/)
    expect(() => vapidAuthorization('', vapid, NOW)).toThrow(/endpoint/)
  })

  it('no firma con un contacto que los servicios rechazan', () => {
    const withSubject = (subject: string) => () =>
      vapidAuthorization(ENDPOINT, { ...keys, subject }, NOW)

    expect(withSubject('avisos@example.com')).toThrow(/sub/)
    expect(withSubject('mailto: avisos@example.com')).toThrow(/sub/)
    expect(withSubject('mailto:<avisos@example.com>')).toThrow(/sub/)
    expect(withSubject('mailto:HUB <avisos@example.com>')).toThrow(/sub/)
    expect(withSubject('http://app.example.com')).toThrow(/sub/)
    expect(withSubject('')).toThrow(/sub/)
  })

  it('no firma con un par que no es un par', () => {
    const other = generateVapidKeys()
    const mixed = {
      publicKey: other.publicKey,
      privateKey: keys.privateKey,
      subject: vapid.subject,
    }
    expect(() => vapidAuthorization(ENDPOINT, mixed, NOW)).toThrow(/no es la de esa clave privada/)
  })

  it('no firma con claves del tamaño equivocado, ni con una hora que no es un número', () => {
    const shortPrivate = Buffer.from(keys.privateKey, 'base64url').subarray(1).toString('base64url')
    const shortPublic = Buffer.from(keys.publicKey, 'base64url')
      .subarray(0, 33)
      .toString('base64url')

    expect(() => vapidAuthorization(ENDPOINT, { ...vapid, privateKey: shortPrivate }, NOW)).toThrow(
      /privada VAPID/,
    )
    expect(() => vapidAuthorization(ENDPOINT, { ...vapid, publicKey: shortPublic }, NOW)).toThrow(
      /pública VAPID/,
    )
    expect(() =>
      vapidAuthorization(ENDPOINT, {
        ...vapid,
        privateKey: Buffer.alloc(32).toString('base64url'),
      }),
    ).toThrow(/P-256/)
    expect(() => vapidAuthorization(ENDPOINT, vapid, Number.NaN)).toThrow(/hora/)
  })

  it('ningún error repite la clave privada', () => {
    const other = generateVapidKeys()
    let message = ''
    try {
      vapidAuthorization(ENDPOINT, { ...vapid, publicKey: other.publicKey }, NOW)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^web-push: /)
    expect(message).not.toContain(keys.privateKey)
    expect(message).not.toContain(other.publicKey)
  })
})

describe('pushTopic (RFC 8030 §5.4)', () => {
  const tag = 'pos:0b9f4d7e-55f1-4f0a-9d53-0d6a1f1f3a11:6a1c2f60-3d1b-4a55-8f43-6f1f9f0a7c22'

  it('da 32 caracteres del alfabeto base64url, sea lo que sea que entre', () => {
    for (const value of [tag, 'a', '', 'Mesa 12 · para retirar 🍹', 'x'.repeat(5000)]) {
      expect(pushTopic(value)).toMatch(/^[A-Za-z0-9_-]{32}$/)
    }
  })

  it('mismo texto, mismo tema; otro texto, otro tema', () => {
    expect(pushTopic(tag)).toBe(pushTopic(tag))
    expect(pushTopic(tag)).not.toBe(pushTopic(`${tag}x`))
    expect(pushTopic('a')).not.toBe(pushTopic('b'))
  })
})

describe('buildPushRequest', () => {
  const keys = generateVapidKeys()
  const vapid: VapidDetails = { ...keys, subject: 'mailto:avisos@example.com' }
  const payload = JSON.stringify({
    v: 1,
    title: 'Mesa 4 · para retirar',
    body: '🍕 Pizzeros: 2 Muzza',
  })

  it('arma el pedido entero: a dónde, las cabeceras y el cuerpo cifrado para ese teléfono', () => {
    const phone = browser()
    const request = buildPushRequest({
      subscription: { endpoint: ENDPOINT, ...phone.keys },
      payload,
      vapid,
      ttlSeconds: 600,
      urgency: 'high',
      topic: 'pos:mesa-4:pizzeros',
      nowSeconds: NOW,
    })

    expect(request.endpoint).toBe(ENDPOINT)
    expect(Object.keys(request.headers).sort()).toEqual([
      'Authorization',
      'Content-Encoding',
      'Content-Type',
      'TTL',
      'Topic',
      'Urgency',
    ])
    expect(request.headers['Content-Encoding']).toBe('aes128gcm')
    expect(request.headers['Content-Type']).toBe('application/octet-stream')
    expect(request.headers.TTL).toBe('600')
    expect(request.headers.Urgency).toBe('high')
    expect(request.headers.Topic).toBe(pushTopic('pos:mesa-4:pizzeros'))

    const auth = readVapid(request.headers.Authorization ?? '')
    expect(auth.verified).toBe(true)
    expect(auth.key).toBe(keys.publicKey)
    expect(auth.claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: NOW + 12 * 60 * 60,
      sub: vapid.subject,
    })

    const opened = receive(request.body, phone.privateKey, phone.auth)
    expect(opened.plaintext.toString('utf8')).toBe(payload)
  })

  it('sin más datos: 5 minutos, urgencia normal y sin tema', () => {
    const phone = browser()
    const request = buildPushRequest({
      subscription: { endpoint: ENDPOINT, ...phone.keys },
      payload,
      vapid,
    })

    expect(request.headers.TTL).toBe('300')
    expect(request.headers.Urgency).toBe('normal')
    expect(request.headers).not.toHaveProperty('Topic')
    expect(readVapid(request.headers.Authorization ?? '').verified).toBe(true)
  })

  it('acepta un TTL de cero (entregar ya o nunca) y las cuatro urgencias', () => {
    const phone = browser()
    const subscription = { endpoint: ENDPOINT, ...phone.keys }

    expect(buildPushRequest({ subscription, payload, vapid, ttlSeconds: 0 }).headers.TTL).toBe('0')
    for (const urgency of ['very-low', 'low', 'normal', 'high'] as const) {
      expect(buildPushRequest({ subscription, payload, vapid, urgency }).headers.Urgency).toBe(
        urgency,
      )
    }
  })

  it('reusa la firma para el mismo servicio y la renueva a las 6 horas', () => {
    const phone = browser()
    const other = browser()
    const own = { ...generateVapidKeys(), subject: 'mailto:avisos@example.com' }
    const at = (nowSeconds: number, endpoint: string, keys: PushKeys) =>
      buildPushRequest({ subscription: { endpoint, ...keys }, payload, vapid: own, nowSeconds })
        .headers.Authorization ?? ''

    const first = at(NOW, 'https://fcm.googleapis.com/fcm/send/uno', phone.keys)
    // Otro teléfono, mismo servicio, casi 6 horas después: la misma firma (Apple pide no renovarla
    // más de una vez por hora).
    expect(at(NOW + 6 * 3600 - 1, 'https://fcm.googleapis.com/fcm/send/dos', other.keys)).toBe(
      first,
    )
    // Otro servicio: otra firma, dirigida a ese origen.
    const apple = at(NOW, 'https://web.push.apple.com/tres', phone.keys)
    expect(apple).not.toBe(first)
    expect(readVapid(apple).claims.aud).toBe('https://web.push.apple.com')
    // A las 6 horas se renueva, y la que se entrega nunca está cerca de vencer.
    const renewed = at(NOW + 6 * 3600, 'https://fcm.googleapis.com/fcm/send/uno', phone.keys)
    expect(renewed).not.toBe(first)
    expect(readVapid(renewed).verified).toBe(true)
    expect(readVapid(renewed).claims.exp).toBe(NOW + 18 * 3600)
    // Si el reloj vuelve atrás, no se entrega una firma «del futuro».
    const earlier = at(NOW - 60, 'https://web.push.apple.com/tres', phone.keys)
    expect(readVapid(earlier).claims.exp).toBe(NOW - 60 + 12 * 3600)
  })

  it('una firma reusada no se mezcla entre pares de claves ni entre contactos', () => {
    const phone = browser()
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/uno', ...phone.keys }
    const one = { ...generateVapidKeys(), subject: 'mailto:uno@example.com' }
    const two = { ...generateVapidKeys(), subject: 'mailto:uno@example.com' }
    const header = (details: VapidDetails) =>
      buildPushRequest({ subscription, payload, vapid: details, nowSeconds: NOW }).headers
        .Authorization ?? ''

    expect(readVapid(header(one)).key).toBe(one.publicKey)
    expect(readVapid(header(two)).key).toBe(two.publicKey)
    expect(readVapid(header({ ...one, subject: 'mailto:dos@example.com' })).claims.sub).toBe(
      'mailto:dos@example.com',
    )
    expect(header(one)).toBe(header(one))
  })

  it('no arma un pedido con un TTL o una urgencia que el servicio va a rechazar', () => {
    const phone = browser()
    const subscription = { endpoint: ENDPOINT, ...phone.keys }
    const build = (extra: Record<string, unknown>) => () =>
      buildPushRequest({ subscription, payload, vapid, ...extra } as Parameters<
        typeof buildPushRequest
      >[0])

    expect(build({ ttlSeconds: -1 })).toThrow(/TTL/)
    expect(build({ ttlSeconds: 1.5 })).toThrow(/TTL/)
    expect(build({ ttlSeconds: Number.NaN })).toThrow(/TTL/)
    expect(build({ urgency: 'urgente' })).toThrow(/urgencia/)
    expect(build({ nowSeconds: Number.POSITIVE_INFINITY })).toThrow(/hora/)
  })

  it('no arma un pedido si la suscripción o el endpoint están rotos', () => {
    const phone = browser()
    expect(() =>
      buildPushRequest({
        subscription: { endpoint: 'http://fcm.googleapis.com/x', ...phone.keys },
        payload,
        vapid,
      }),
    ).toThrow(/https/)
    expect(() =>
      buildPushRequest({
        subscription: { endpoint: ENDPOINT, p256dh: 'AAAA', auth: phone.keys.auth },
        payload,
        vapid,
      }),
    ).toThrow(/p256dh/)
    expect(() =>
      buildPushRequest({ subscription: { endpoint: ENDPOINT, ...phone.keys }, payload: '', vapid }),
    ).toThrow(/vacío/)
  })
})

describe('pushOutcome', () => {
  it('2xx es que el servicio lo aceptó', () => {
    for (const status of [200, 201, 202, 204]) expect(pushOutcome(status)).toBe('ok')
  })

  it('404 y 410 son una suscripción que ya no existe', () => {
    expect(pushOutcome(404)).toBe('gone')
    expect(pushOutcome(410)).toBe('gone')
  })

  it('todo lo demás, o no tener respuesta, es una falla', () => {
    for (const status of [301, 302, 400, 401, 403, 405, 413, 429, 500, 502, 503]) {
      expect(pushOutcome(status)).toBe('failed')
    }
    expect(pushOutcome(null)).toBe('failed')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// lib/push/vapid.ts: de dónde salen las claves y el contacto. La base es de mentira.
// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('vapidSubject', () => {
  it('usa la dirección de EMAIL_FROM, sin el nombre', async () => {
    const { vapidSubject } = await import('@/lib/push/vapid')

    expect(vapidSubject({ EMAIL_FROM: 'HUB! Coffee & Bar <avisos@example.com>' })).toBe(
      'mailto:avisos@example.com',
    )
    expect(vapidSubject({ EMAIL_FROM: '  avisos@example.com ' })).toBe('mailto:avisos@example.com')
    expect(vapidSubject({ EMAIL_FROM: '"Avisos" < avisos@mail.example.com >' })).toBe(
      'mailto:avisos@mail.example.com',
    )
  })

  it('sin un mail que se entienda, vale la dirección https de la app', async () => {
    const { vapidSubject } = await import('@/lib/push/vapid')

    expect(vapidSubject({ NEXT_PUBLIC_APP_URL: 'https://app.example.com/' })).toBe(
      'https://app.example.com',
    )
    expect(
      vapidSubject({ EMAIL_FROM: 'sin arroba', NEXT_PUBLIC_APP_URL: 'https://app.example.com/x' }),
    ).toBe('https://app.example.com')
    expect(
      vapidSubject({
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        VERCEL_PROJECT_PRODUCTION_URL: 'app.example.com',
      }),
    ).toBe('https://app.example.com')
  })

  it('una dirección local o sin https no sirve de contacto', async () => {
    const { vapidSubject } = await import('@/lib/push/vapid')

    expect(vapidSubject({})).toBeNull()
    expect(vapidSubject({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' })).toBeNull()
    expect(vapidSubject({ NEXT_PUBLIC_APP_URL: 'https://localhost:3000' })).toBeNull()
    expect(vapidSubject({ NEXT_PUBLIC_APP_URL: 'http://app.example.com' })).toBeNull()
    expect(vapidSubject({ EMAIL_FROM: 'a@b', NEXT_PUBLIC_APP_URL: 'cualquier cosa' })).toBeNull()
  })

  it('lo que devuelve siempre sirve para firmar', async () => {
    const { vapidSubject } = await import('@/lib/push/vapid')
    const keys = generateVapidKeys()

    for (const env of [
      { EMAIL_FROM: 'HUB <avisos@example.com>' },
      { NEXT_PUBLIC_APP_URL: 'https://app.example.com' },
      { VERCEL_PROJECT_PRODUCTION_URL: 'app.example.com' },
    ]) {
      const subject = vapidSubject(env) ?? ''
      expect(readVapid(vapidAuthorization(ENDPOINT, { ...keys, subject }, NOW)).verified).toBe(true)
    }
  })
})

describe('getVapid', () => {
  type Stored = { public: string | null; private: string | null }

  /** Las dos funciones de la base, de mentira: guardan el par solo si no había uno. */
  function fakeService(stored: Stored, onInit?: (stored: Stored) => void) {
    const rpc = vi.fn(async (name: string, args?: { p_public: string; p_private: string }) => {
      if (name === 'push_vapid_keys') return { data: { ...stored }, error: null }
      if (name === 'push_vapid_init' && args) {
        if (onInit) onInit(stored)
        if (stored.private === null) {
          stored.public = args.p_public
          stored.private = args.p_private
        }
        return { data: stored.public, error: null }
      }
      return { data: null, error: { message: `función desconocida: ${name}` } }
    })
    return { rpc, client: { rpc } as unknown as SupabaseClient }
  }

  beforeEach(() => {
    // Cada prueba arranca sin nada recordado.
    vi.resetModules()
    vi.stubEnv('EMAIL_FROM', 'HUB! Coffee & Bar <avisos@example.com>')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('devuelve el par guardado y el contacto, y no vuelve a ir a la base', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const keys = generateVapidKeys()
    const { rpc, client } = fakeService({ public: keys.publicKey, private: keys.privateKey })

    const vapid = await getVapid(client)
    expect(vapid).toEqual({ ...keys, subject: 'mailto:avisos@example.com' })
    expect(await getVapid(client)).toBe(vapid)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('push_vapid_keys')
  })

  it('si no hay par, lo genera, lo guarda y usa el que quedó guardado', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const stored: Stored = { public: null, private: null }
    const { rpc, client } = fakeService(stored)

    const vapid = await getVapid(client)

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'push_vapid_keys',
      'push_vapid_init',
      'push_vapid_keys',
    ])
    expect(vapid.publicKey).toBe(stored.public)
    expect(vapid.privateKey).toBe(stored.private)
    // Lo que valida `push_vapid_init`: entre 80 y 100, y entre 40 y 50 caracteres.
    expect(vapid.publicKey).toHaveLength(87)
    expect(vapid.privateKey).toHaveLength(43)
    expect(readVapid(vapidAuthorization(ENDPOINT, vapid, NOW)).verified).toBe(true)
  })

  it('si otro proceso guardó el suyo un instante antes, gana ese', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const winner = generateVapidKeys()
    const { rpc, client } = fakeService({ public: null, private: null }, (stored) => {
      stored.public = winner.publicKey
      stored.private = winner.privateKey
    })

    const vapid = await getVapid(client)

    expect(vapid.publicKey).toBe(winner.publicKey)
    expect(vapid.privateKey).toBe(winner.privateKey)
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('sin contacto no hace nada: ni lee ni genera', async () => {
    vi.stubEnv('EMAIL_FROM', '')
    const { getVapid } = await import('@/lib/push/vapid')
    const { rpc, client } = fakeService({ public: null, private: null })

    await expect(getVapid(client)).rejects.toThrow(/EMAIL_FROM/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('si la base falla, avisa y no recuerda nada', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const keys = generateVapidKeys()
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'forbidden' } })
      .mockResolvedValue({
        data: { public: keys.publicKey, private: keys.privateKey },
        error: null,
      })
    const client = { rpc } as unknown as SupabaseClient

    await expect(getVapid(client)).rejects.toThrow('push_vapid_keys: forbidden')
    expect((await getVapid(client)).publicKey).toBe(keys.publicKey)
  })

  it('si no se pudo guardar el par nuevo, avisa', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const rpc = vi.fn(async (name: string) =>
      name === 'push_vapid_keys'
        ? { data: { public: null, private: null }, error: null }
        : { data: null, error: { message: 'invalid_keys' } },
    )

    await expect(getVapid({ rpc } as unknown as SupabaseClient)).rejects.toThrow(
      'push_vapid_init: invalid_keys',
    )
  })

  it('no usa un par incompleto, mezclado o con otra forma, ni lo repite en el error', async () => {
    const { getVapid } = await import('@/lib/push/vapid')
    const keys = generateVapidKeys()
    const other = generateVapidKeys()
    const failure = async (data: unknown) => {
      const rpc = vi.fn(async () => ({ data, error: null }))
      try {
        await getVapid({ rpc } as unknown as SupabaseClient)
        return 'no falló'
      } catch (error) {
        return (error as Error).message
      }
    }

    const incomplete = await failure({ public: keys.publicKey, private: null })
    const mixed = await failure({ public: other.publicKey, private: keys.privateKey })
    const shapeless = await failure(['cualquier', 'cosa'])

    expect(incomplete).toMatch(/incompleto/)
    expect(mixed).toMatch(/no es la de esa clave privada/)
    expect(shapeless).toMatch(/respuesta inesperada/)
    for (const message of [incomplete, mixed, shapeless]) {
      expect(message).not.toContain(keys.privateKey)
      expect(message).not.toContain(keys.publicKey)
      expect(message).not.toContain(other.publicKey)
    }
  })
})
