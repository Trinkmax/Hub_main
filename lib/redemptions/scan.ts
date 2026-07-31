// Parser ÚNICO de lo que sale de un escaneo (PURO → testeable).
//
// El mozo no se tiene que acordar de qué pantalla abrir: el mismo escáner
// reconoce los dos QR que circulan por el salón y la UI rutea sola.
//
//   /c/<qr_token>      → QR personal del socio  → acreditar puntos / sellar
//   /v/<redeem_token>  → QR de un canje pedido  → validar y entregar
//
// Acepta URL completa, path suelto o el token pelado (carga manual). El token
// pelado es ambiguo por definición — los dos tienen el mismo formato — así que
// el caller decide qué significa en SU pantalla vía `fallback`.

export type ScanKind = 'customer' | 'redemption'

export type ScannedCode = { kind: ScanKind; token: string }

const TOKEN = '[A-Za-z0-9_-]{16,128}'
const CUSTOMER_RE = new RegExp(`/c/(${TOKEN})`)
const REDEMPTION_RE = new RegExp(`/v/(${TOKEN})`)
const RAW_RE = new RegExp(`^${TOKEN}$`)

export function parseScannedCode(raw: string, fallback: ScanKind): ScannedCode | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const redemption = trimmed.match(REDEMPTION_RE)
  if (redemption?.[1]) return { kind: 'redemption', token: redemption[1] }

  const customer = trimmed.match(CUSTOMER_RE)
  if (customer?.[1]) return { kind: 'customer', token: customer[1] }

  // Carga manual: la billetera muestra el código agrupado de a 4 ("Ab3d Ef7h …")
  // justamente para que se pueda dictar, así que el mozo lo tipea CON espacios.
  // Sin esta normalización el fallback fallaba siempre y la única salida cuando
  // la cámara no anda quedaba muerta.
  const noSpaces = trimmed.replace(/\s+/g, '')
  if (RAW_RE.test(noSpaces)) return { kind: fallback, token: noSpaces }

  // Segundo intento sacando guiones de dictado. Va después y no antes porque
  // el formato de token admite `-`: si el código lo tuviera de verdad, el
  // intento anterior ya lo resolvió sin mutilarlo.
  const noDashes = noSpaces.replace(/-/g, '')
  if (RAW_RE.test(noDashes)) return { kind: fallback, token: noDashes }
  return null
}
