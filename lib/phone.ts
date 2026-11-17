/**
 * Normalización de teléfonos a E.164 (formato `+CCNNNN...`).
 *
 * Caso de uso primario: bar argentino capturando WhatsApp en mesa.
 * Por defecto asumimos AR cuando no hay código de país explícito y
 * agregamos el `9` móvil cuando falta — el 99% de uso real es WhatsApp.
 *
 * Reglas:
 *  - Acepta espacios, guiones, paréntesis, puntos y barras como separadores,
 *    y descarta las marcas invisibles que trae un número copiado.
 *  - `0` inicial, `15` de móvil viejo y `9` del formato internacional se
 *    entienden en cualquier combinación, con o sin `+54` (y con el `54`
 *    repetido).
 *  - `00` adelante es el prefijo para llamar al exterior: `0054…` = `+54…`.
 *  - Con `+` y otro código de país: primero se mira si en realidad es un
 *    número argentino al que le borraron el `+54` (ver `normalizeForeign`);
 *    si no, tiene que tener el largo de un número de su país.
 *  - Lo que sale siempre cumple `^\+[1-9]\d{7,14}$`, la regla de la base.
 */

import { isPossiblePhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js'

export class InvalidPhoneError extends Error {
  readonly code = 'invalid_phone'
  constructor(message = 'Teléfono inválido.') {
    super(message)
    this.name = 'InvalidPhoneError'
  }
}

const AR_CC = '54'

/** Lo que la base acepta (CHECK de ticket_orders.guest_phone y compañía). */
const E164 = /^\+[1-9]\d{7,14}$/

/**
 * Marcas invisibles que llegan al copiar un número de WhatsApp o de los
 * contactos del celular: marcas de dirección y espacios de ancho cero. Sin
 * sacarlas, «\u202A+54 9 351 555-1234\u202C» no parecía un teléfono.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g

function stripFormatting(input: string): string {
  return input.replace(/[\s\-()./]/g, '')
}

/**
 * Las características argentinas empiezan con 11, 22–29 o 33–38: ninguna con
 * 0, 12–19, 20, 21, 30–32, 39 ni del 4 al 9. Alcanza para distinguir un número
 * argentino de uno de otro país sin cargar la lista de áreas.
 */
const AR_NATIONAL = /^(?:11|2[2-9]|3[3-8])\d{8}$/

/** «351 15 555 1234» → «3515551234»: el 15 del celular, entre la característica y el número. */
function stripMobile15(n: string): string | null {
  const m = n.match(/^(\d{2,4})15(\d{6,8})$/)
  return m?.[1] && m[2] && m[1].length + m[2].length === 10 ? `${m[1]}${m[2]}` : null
}

/**
 * El número nacional argentino (característica + número, 10 dígitos) tal como
 * lo escribe la gente: con o sin el 0, con o sin el 15, con el 9 del formato
 * internacional y hasta con el 54 repetido (el campo ya traía el +54 y la
 * persona lo volvió a escribir). null si no se lee como un número argentino.
 *   «0351 15 555 1234» · «9 351 555 1234» · «54 9 351 555 1234» → «3515551234»
 */
export function argentineNationalNumber(digits: string): string | null {
  let n = digits
  // El 54 (y el 54 repetido): ninguna característica argentina empieza con 5.
  while (n.startsWith(AR_CC) && n.length >= 12) n = n.slice(AR_CC.length)
  // El 0 de larga distancia («0351 …»).
  if (n.startsWith('0')) n = n.slice(1)
  // El 9 del celular en formato internacional («9 351 …», «9 351 15 …»).
  if (n.startsWith('9') && (n.length === 11 || n.length === 13)) n = n.slice(1)
  // El 15 del celular en formato viejo («351 15 555 1234»).
  if (n.length === 12) n = stripMobile15(n) ?? n
  return AR_NATIONAL.test(n) ? n : null
}

/**
 * Un número que vino con `+` y un código que no es el 54.
 *
 * El campo de teléfono ya trae el +54 y hay quien lo borra y escribe su número
 * como siempre: así llegaban «+0351…» (ningún país empieza con 0, y la base lo
 * rechazaba), «+351 555 1234» (Córdoba, que el campo tomaba por Portugal) o
 * «+9 351…» (Afganistán). Si los dígitos se leen como un número argentino, se
 * guarda como argentino aunque también existan en otro país: el bar vende en
 * Argentina, y es mucho más probable un cordobés sin el +54 que un turista
 * islandés con un número que coincide con uno de La Falda. Si no, tiene que
 * tener el largo de un número de su país (`isPossiblePhoneNumber`: el largo,
 * no los dígitos, para no rechazar números nuevos que la librería todavía no
 * conoce). Los celulares de México con el 1 («+52 1 55…») pasan como vinieron:
 * así los escribe WhatsApp.
 */
function normalizeForeign(digits: string): string {
  const national = argentineNationalNumber(digits)
  if (national) return `+${AR_CC}9${national}`
  const e164 = `+${digits}`
  if (!E164.test(e164)) throw new InvalidPhoneError()
  if (!isPossiblePhoneNumber(e164) && !/^\+521\d{10}$/.test(e164)) throw new InvalidPhoneError()
  return e164
}

export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string') throw new InvalidPhoneError()

  const trimmed = raw.replace(INVISIBLE, '').trim()
  if (!trimmed) throw new InvalidPhoneError()

  let international = trimmed.startsWith('+')
  let digits = stripFormatting(international ? trimmed.slice(1) : trimmed)
  if (!/^\d+$/.test(digits)) throw new InvalidPhoneError()

  // «00» adelante es el prefijo para llamar al exterior (ninguna
  // característica argentina empieza con 0): «0054 9 351…» = «+54 9 351…».
  if (!international && digits.startsWith('00')) {
    international = true
    digits = digits.slice(2)
  }

  if (international && !digits.startsWith(AR_CC)) return normalizeForeign(digits)

  // Argentino: con +54 o 54, con 0, con 15, con 9 o los 10 dígitos pelados.
  const national = argentineNationalNumber(digits)
  if (!national) throw new InvalidPhoneError()
  return `+${AR_CC}9${national}`
}

/**
 * Versión "safe" para uso en zod transforms: no tira, devuelve null si falla.
 */
export function tryNormalizePhone(raw: string): string | null {
  try {
    return normalizePhone(raw)
  } catch {
    return null
  }
}

/**
 * El teléfono tal como se guarda: E.164 con el `9` móvil argentino.
 *
 * `react-phone-number-input` entrega «+543511234567» cuando el número se tipea
 * sin el 9 (así lo arma libphonenumber), y los formularios de reservas, clientes
 * y entradas lo guardaban tal cual porque ya «era válido». La misma persona
 * terminaba con dos fichas: la de la reserva sin el 9 y la del club o la entrada
 * con el 9. Ahora primero se normaliza. Lo que normalizePhone no entiende y
 * libphonenumber sí (una interna: «+54 9 351 555 1234 int. 2») se guarda como
 * el E.164 que arma libphonenumber, nunca como vino: la base solo acepta `+` y
 * dígitos.
 */
export function canonicalPhone(raw: string): string | null {
  const trimmed = raw.replace(INVISIBLE, '').trim()
  if (!trimmed) return null
  const normalized = tryNormalizePhone(trimmed)
  if (normalized) return normalized
  const parsed = trimmed.startsWith('+') ? parsePhoneNumberFromString(trimmed) : undefined
  return parsed?.isPossible() ? tryNormalizePhone(parsed.number) : null
}

/**
 * Si un teléfono escrito todavía no se puede guardar, qué clase de número es,
 * para decir algo útil en el campo en vez de «no es válido»: `argentina` (le
 * faltan o le sobran números, o la característica no existe) u `other` (vino
 * con el código de otro país y allá no es un número válido). null si está bien
 * o si está vacío: eso lo dice el formulario.
 */
export function phoneProblem(raw: string | null | undefined): 'argentina' | 'other' | null {
  const clean = raw?.replace(INVISIBLE, '').trim() ?? ''
  if (!clean || canonicalPhone(clean)) return null
  const digits = clean.replace(/\D/g, '')
  return !clean.startsWith('+') || digits.startsWith(AR_CC) ? 'argentina' : 'other'
}

/**
 * Un teléfono ya normalizado, para mostrarlo: «+54 9 351 555 1234»,
 * «+54 9 11 5555 1234», «+34 612 34 56 78». libphonenumber sabe dónde cortar
 * cada característica (formatPhoneForDisplay asume 3 dígitos).
 */
export function formatPhoneInternational(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164
}

/**
 * Las formas en que puede estar guardado el mismo celular argentino: con el 9
 * (la canónica, primero) y sin él (fichas viejas de reservas). Es para BUSCAR,
 * nunca para guardar: el resto de los países vuelve como vino.
 *   +5493512345678 → [+5493512345678, +543512345678]
 */
export function phoneVariants(e164: string): string[] {
  const withNine = e164.match(/^\+549(\d{10})$/)
  if (withNine) return [e164, `+${AR_CC}${withNine[1]}`]
  const withoutNine = e164.match(/^\+54([1-8]\d{9})$/)
  if (withoutNine) return [`+${AR_CC}9${withoutNine[1]}`, e164]
  return [e164]
}

/**
 * Construye una URL de wa.me a partir de cualquier string de teléfono.
 * Stripea todo lo que no sea dígito y arma `https://wa.me/<digits>?text=<encoded>`.
 * Si `phone` está vacío devuelve null.
 */
export function buildWaMeUrl(phone: string, text?: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  const base = `https://wa.me/${digits}`
  if (!text) return base
  return `${base}?text=${encodeURIComponent(text)}`
}

/**
 * Formatea un E.164 para mostrar al usuario.
 * Solo cosmético — la fuente de verdad es siempre el E.164.
 */
export function formatPhoneForDisplay(e164: string): string {
  if (e164.startsWith(`+${AR_CC}9`) && e164.length === 14) {
    // +54 9 351 555-1234
    const cc = e164.slice(0, 3)
    const mob = e164.slice(3, 4)
    const area = e164.slice(4, 7)
    const a = e164.slice(7, 10)
    const b = e164.slice(10, 14)
    return `${cc} ${mob} ${area} ${a}-${b}`
  }
  return e164
}

/**
 * Formato que espera la WhatsApp Cloud API para números argentinos: SIN el `9`
 * de celular. El app guarda E.164 con `9` (+549...), pero en AR el `9` no es
 * parte del "WhatsApp ID" (Meta normaliza +54<area><número>). Si se manda con el
 * 9, el envío falla (ej. #131030 al estar fuera de la allowed-list del número de
 * prueba). Otros países y AR sin 9 (fijos) se devuelven igual.
 *   +5493512345678 → +543512345678
 */
export function formatForWhatsApp(e164: string): string {
  if (e164.startsWith(`+${AR_CC}9`) && e164.length === 14) {
    return `+${AR_CC}${e164.slice(4)}`
  }
  return e164
}

/**
 * Clave canónica de conversación a partir de un teléfono/wa_id. Unifica el
 * hilado inbound/outbound: el outbound guardaba el E.164 con el `9` de celular AR
 * (`+5493512345678`), pero el `wa_id` que Meta manda en el inbound viene SIN el 9
 * (`543512345678`). Sin unificar, cada cliente terminaba con DOS conversaciones y
 * el chequeo de ventana 24h leía el hilo vacío. Normaliza a dígitos, sin `+` y sin
 * el `9` móvil AR.
 *   +5493512345678 → 543512345678 ; 543512345678 → 543512345678
 */
export function conversationKey(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  // AR móvil: 54 + 9 + 10 dígitos = 13 → sacamos el 9 para igualar el wa_id de Meta.
  if (digits.startsWith(`${AR_CC}9`) && digits.length === 13) {
    return `${AR_CC}${digits.slice(3)}`
  }
  return digits
}
