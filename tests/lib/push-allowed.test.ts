import { describe, expect, it } from 'vitest'
import { isAllowedPushEndpoint } from '@/lib/push/allowed'

describe('isAllowedPushEndpoint — los servicios de push de verdad', () => {
  it.each([
    // Chrome y los que usan el servicio de Google: la forma de siempre y la nueva.
    'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8',
    'https://fcm.googleapis.com/wp/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8',
    'https://jmt17.google.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv',
    // Safari y las apps instaladas en iPhone.
    'https://web.push.apple.com/QGmJxyz0123456789',
    'https://otro.push.apple.com/QGmJxyz0123456789',
    // Firefox.
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl0123456789',
    'https://otro.push.services.mozilla.com/wpush/v1/abc',
    // Edge.
    'https://wns2-by3p.notify.windows.com/w/?token=AwYAAAD%2bR8cG%2f1',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('%s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true)
  })

  it('no le importa cómo venga escrito el nombre ni que diga el puerto de siempre', () => {
    expect(isAllowedPushEndpoint('https://FCM.GoogleApis.com/fcm/send/abc')).toBe(true)
    expect(isAllowedPushEndpoint('HTTPS://fcm.googleapis.com:443/fcm/send/abc')).toBe(true)
    expect(isAllowedPushEndpoint('https://Web.Push.Apple.com/abc')).toBe(true)
  })
})

describe('isAllowedPushEndpoint — lo que no pasa', () => {
  it.each([
    ['sin https', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['otro protocolo', 'ftp://fcm.googleapis.com/fcm/send/abc'],
    ['otro protocolo con el nombre bien', 'wss://web.push.apple.com/abc'],
    ['sin protocolo', '//fcm.googleapis.com/fcm/send/abc'],
    ['solo el nombre', 'fcm.googleapis.com/fcm/send/abc'],
    ['vacío', ''],
    ['no es una dirección', 'cualquier cosa'],
    ['javascript', 'javascript:alert(1)'],
    ['un archivo', 'file:///etc/passwd'],
  ])('%s', (_what, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false)
  })

  it.each([
    ['IPv4', 'https://10.0.0.5/push'],
    ['IPv4 local', 'https://127.0.0.1/push'],
    ['los metadatos de la nube', 'https://169.254.169.254/latest/meta-data/'],
    ['IPv4 en hexadecimal', 'https://0x7f.1/push'],
    ['IPv4 como un solo número', 'https://2130706433/push'],
    ['IPv6', 'https://[::1]/push'],
    ['IPv6 que envuelve una IPv4', 'https://[::ffff:127.0.0.1]/push'],
    ['localhost', 'https://localhost/push'],
    ['un nombre interno', 'https://supabase-db.internal/push'],
  ])('una dirección interna o una IP (%s)', (_what, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false)
  })

  it.each([
    ['otro puerto', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['el puerto de http', 'https://fcm.googleapis.com:80/fcm/send/abc'],
    ['otro puerto en Apple', 'https://web.push.apple.com:2197/abc'],
    ['usuario y contraseña', 'https://user:pass@fcm.googleapis.com/fcm/send/abc'],
    ['solo usuario', 'https://user@fcm.googleapis.com/fcm/send/abc'],
    ['solo contraseña', 'https://:pass@web.push.apple.com/abc'],
  ])('un puerto que no es el de siempre o credenciales en la dirección (%s)', (_what, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false)
  })

  it.each([
    [
      'el nombre de verdad como subdominio de otro',
      'https://fcm.googleapis.com.evil.test/fcm/send/abc',
    ],
    ['lo mismo con Apple', 'https://web.push.apple.com.evil.test/abc'],
    ['el nombre de verdad en el usuario', 'https://fcm.googleapis.com@evil.test/fcm/send/abc'],
    ['el nombre de verdad en el camino', 'https://evil.test/fcm.googleapis.com/fcm/send/abc'],
    ['el nombre de verdad en la consulta', 'https://evil.test/?u=https://fcm.googleapis.com/'],
    ['el nombre de verdad después del #', 'https://evil.test#@fcm.googleapis.com/'],
    ['una barra invertida antes del nombre', 'https://evil.test\\.push.apple.com/abc'],
    ['un punto escondido en %2e', 'https://fcm.googleapis.com%2eevil.test/fcm/send/abc'],
    ['pegado adelante, sin punto', 'https://evilfcm.googleapis.com/fcm/send/abc'],
    ['pegado adelante en Apple', 'https://evilpush.apple.com/abc'],
    ['pegado adelante en Windows', 'https://evilnotify.windows.com/w/?token=abc'],
    ['un subdominio del de Google', 'https://evil.fcm.googleapis.com/fcm/send/abc'],
    ['otro servicio de Google', 'https://www.googleapis.com/fcm/send/abc'],
    ['otro nombre de Google', 'https://jmt18.google.com/fcm/send/abc'],
    ['el dominio pelado de Apple', 'https://push.apple.com/abc'],
    ['el dominio pelado de Mozilla', 'https://push.services.mozilla.com/wpush/v2/abc'],
    ['el dominio pelado de Windows', 'https://notify.windows.com/w/?token=abc'],
    ['el nombre de verdad con otra terminación', 'https://web.push.apple.com.co/abc'],
    ['una parte vacía adelante', 'https://.push.apple.com/abc'],
    ['una parte vacía en el medio', 'https://a..notify.windows.com/w/?token=abc'],
    ['un punto al final', 'https://fcm.googleapis.com./fcm/send/abc'],
    ['un punto al final en Apple', 'https://web.push.apple.com./abc'],
  ])('un nombre que se parece al de verdad (%s)', (_what, endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false)
  })

  it('lo que no es un texto', () => {
    for (const value of [null, undefined, 42, {}, ['https://fcm.googleapis.com/x']]) {
      expect(isAllowedPushEndpoint(value as unknown as string)).toBe(false)
    }
  })

  it('decide sobre el mismo nombre al que después va el pedido', () => {
    // `fetch` lee la dirección igual que `URL`: lo que acá pasa por ser de Google, va a Google.
    const tricky = 'https://fcm.googleapis.com\\@evil.test/fcm/send/abc'
    expect(new URL(tricky).hostname).toBe('fcm.googleapis.com')
    expect(isAllowedPushEndpoint(tricky)).toBe(true)
  })
})
