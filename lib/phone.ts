/**
 * Normalización de teléfonos a E.164 (formato `+CCNNNN...`).
 *
 * Caso de uso primario: bar argentino capturando WhatsApp en mesa.
 * Por defecto asumimos AR cuando no hay código de país explícito y
 * agregamos el `9` móvil cuando falta — el 99% de uso real es WhatsApp.
 *
 * Reglas:
 *  - Acepta espacios, guiones, paréntesis y puntos como separadores.
 *  - `0` inicial y `15` de móvil viejo argentino se descartan.
 *  - Si llega con `+` lo respetamos para cualquier país.
 *  - Si arranca con `54` y largo válido, se completa el `+` y el `9` móvil.
 *  - 10 dígitos sin código país → asume AR móvil (`+54 9 ...`).
 *  - Cualquier cosa fuera de [8, 15] dígitos resultantes se rechaza.
 */

export class InvalidPhoneError extends Error {
  readonly code = 'invalid_phone'
  constructor(message = 'Teléfono inválido.') {
    super(message)
    this.name = 'InvalidPhoneError'
  }
}

const AR_CC = '54'

function stripFormatting(input: string): string {
  return input.replace(/[\s\-().]/g, '')
}

function ensureArMobilePrefix(localDigits: string): string {
  // localDigits aquí es el número AR sin código país, sin 0 inicial, sin 15.
  // Si ya empieza con 9 (móvil), lo respetamos. Si no, lo agregamos.
  return localDigits.startsWith('9') ? localDigits : `9${localDigits}`
}

export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string') throw new InvalidPhoneError()

  const trimmed = raw.trim()
  if (!trimmed) throw new InvalidPhoneError()

  const startsWithPlus = trimmed.startsWith('+')
  const cleaned = stripFormatting(trimmed.replace(/^\+/, ''))

  if (!/^\d+$/.test(cleaned)) throw new InvalidPhoneError()

  // Caso 1: vino con `+` explícito → respetar país, normalizar AR si aplica
  if (startsWithPlus) {
    if (cleaned.startsWith(AR_CC)) {
      return `+${AR_CC}${normalizeArDomestic(cleaned.slice(AR_CC.length))}`
    }
    // Otros países: validamos rango razonable y devolvemos
    if (cleaned.length < 8 || cleaned.length > 15) throw new InvalidPhoneError()
    return `+${cleaned}`
  }

  // Caso 2: arranca con `54` y largo plausible (12-13 dígitos) → AR sin `+`
  if (cleaned.startsWith(AR_CC) && cleaned.length >= 12 && cleaned.length <= 13) {
    return `+${AR_CC}${normalizeArDomestic(cleaned.slice(AR_CC.length))}`
  }

  // Caso 3: arranca con 0 → drop 0 (formato AR doméstico viejo)
  if (cleaned.startsWith('0')) {
    return `+${AR_CC}${normalizeArDomestic(cleaned.slice(1))}`
  }

  // Caso 4: 10 dígitos sin contexto → asumir AR móvil
  if (cleaned.length === 10) {
    return `+${AR_CC}${ensureArMobilePrefix(cleaned)}`
  }

  // Caso 5: 11 dígitos arrancando con 9 sin país → AR móvil con 9 explícito
  if (cleaned.length === 11 && cleaned.startsWith('9')) {
    return `+${AR_CC}${cleaned}`
  }

  throw new InvalidPhoneError()
}

/**
 * Normaliza la porción doméstica argentina (sin código país):
 *  - Drop `15` cuando viene después del área (formato móvil viejo).
 *  - Asegura `9` móvil al inicio.
 *  - Rechaza si el largo final no es 11 dígitos (9 + 10 = 11).
 */
function normalizeArDomestic(domestic: string): string {
  let n = domestic

  // Formato móvil viejo: <area><15><número>. Solo aplica cuando la longitud
  // total es 12 (área 2-4 + `15` + número), para no comerse un `15` que
  // forme parte de un número ya correcto en el formato +549...
  if (n.length === 12) {
    const with15 = n.match(/^(\d{2,4})15(\d{6,8})$/)
    if (with15?.[1] && with15[2] && with15[1].length + with15[2].length === 10) {
      n = `${with15[1]}${with15[2]}`
    }
  }

  // Si arranca con 9 ya está marcado como móvil
  if (n.startsWith('9')) {
    if (n.length !== 11) throw new InvalidPhoneError()
    return n
  }

  // Si tiene 10 dígitos sin 9 → asumimos móvil y agregamos
  if (n.length === 10) return `9${n}`

  throw new InvalidPhoneError()
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
