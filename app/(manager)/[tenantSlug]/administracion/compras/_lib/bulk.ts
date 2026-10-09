/**
 * «Cargar una lista» de proveedores o de gastos fijos (pedido de los socios,
 * 09/10/2026): lo puro. Lo prueba `administracion-cargar-lista.test.ts`.
 */

/** La forma de comparar dos nombres: sin mayúsculas, tildes ni espacios de más. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export type ParsedNameList = {
  /** Los nombres a cargar, en el orden en que vinieron y sin repetir. */
  names: string[]
  /** Los que se repetían en la misma lista (se cargan una sola vez). */
  repeated: string[]
  /** Los que ya existen en el bar (no se vuelven a cargar). */
  existing: string[]
  /** Los que no sirven como nombre (menos de 2 letras o más del máximo). */
  invalid: string[]
}

/**
 * Un nombre por renglón, como sale de copiar una columna de una planilla o un
 * mensaje: se recortan los espacios, se sacan viñetas y numeración al
 * principio («- », «• », «1. ») y se saltean los renglones vacíos.
 */
export function parseNameList(
  text: string,
  opts: { existing?: readonly string[]; maxLength?: number } = {},
): ParsedNameList {
  const max = opts.maxLength ?? 120
  const existingKeys = new Map((opts.existing ?? []).map((n) => [nameKey(n), n]))
  const seen = new Set<string>()
  const out: ParsedNameList = { names: [], repeated: [], existing: [], invalid: [] }
  for (const raw of text.split(/\r?\n/)) {
    const name = raw
      .replace(/^\s*(?:[-•*·]|\d{1,3}[.)-])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (name === '') continue
    if (name.length < 2 || name.length > max) {
      out.invalid.push(name)
      continue
    }
    const key = nameKey(name)
    if (seen.has(key)) {
      out.repeated.push(name)
      continue
    }
    seen.add(key)
    if (existingKeys.has(key)) {
      out.existing.push(name)
      continue
    }
    out.names.push(name)
  }
  return out
}

export type AccountHint = { id: string; code: string; name: string }

/**
 * Palabras del nombre de un gasto fijo → palabras de la cuenta que le
 * corresponde en el plan estándar. Es solo una propuesta: cada renglón se
 * puede cambiar antes de cargar.
 */
const ACCOUNT_RULES: ReadonlyArray<{ match: RegExp; account: readonly RegExp[] }> = [
  { match: /\bsueldo|\bjornal|\bpersonal\b|\baguinaldo/, account: [/sueldos?/, /remuneraciones/] },
  {
    match: /\baportes?\b|\bcontribuciones?\b|\bcargas sociales\b|\bf\.?\s?931\b/,
    account: [/cargas sociales/, /contribuciones/, /aportes/],
  },
  { match: /ingresos brutos|\biibb\b|\brentas\b/, account: [/ingresos brutos/, /impuestos/] },
  {
    match: /comercio e industria|\btasa\b|municipal/,
    account: [/tasas? municipal/, /comercio e industria/, /impuestos/, /tasas/],
  },
  { match: /\bseguro/, account: [/seguros?/] },
  { match: /contador|contadora|estudio contable/, account: [/honorarios contables/, /honorarios/] },
  {
    match: /honorario|abogad|escriban|direccion tecnica/,
    account: [/honorarios profesionales/, /honorarios/],
  },
  { match: /\balquiler/, account: [/alquiler/] },
  {
    match: /\bluz\b|\bepec\b|\bgas\b|\bagua\b|aguas|\bservicios?\b/,
    account: [/servicios/, /luz/],
  },
  {
    match: /internet|telefon|celular|\bwifi\b/,
    account: [/internet/, /telefon/, /comunicaciones/],
  },
  {
    match: /alarma|seguridad|vigilancia|ecco|area protegida|emergencia/,
    account: [/seguridad/, /vigilancia/, /servicios/],
  },
  {
    match: /desinfecci|fumigaci|limpieza|residuos|recolecci/,
    account: [/limpieza/, /mantenimiento/, /servicios/],
  },
  { match: /mantenimiento|reparaci/, account: [/mantenimiento/, /reparaciones/] },
  {
    match:
      /suscripci|software|sistema|pedix|youtube|spotify|open ?ia|chatgpt|dominio|hosting|don ?web/,
    account: [/software/, /suscripciones/, /sistemas/, /servicios/],
  },
  {
    match: /nafta|combustible|\bgnc\b|movilidad|viatico/,
    account: [/combustible/, /movilidad/, /rodados/],
  },
  { match: /publicidad|marketing|pauta|redes/, account: [/publicidad/, /marketing/] },
  { match: /monotributo|autonomo/, account: [/impuestos/, /monotributo/, /autonomos/] },
]

/**
 * La cuenta que se propone para un gasto fijo nuevo según su nombre, entre las
 * que se pueden elegir. `null` si no reconoce el nombre (queda la de por
 * defecto que elige la persona).
 */
export function suggestAccount(name: string, accounts: readonly AccountHint[]): string | null {
  const key = nameKey(name)
  for (const rule of ACCOUNT_RULES) {
    if (!rule.match.test(key)) continue
    for (const wanted of rule.account) {
      const hit = accounts.find((a) => wanted.test(nameKey(a.name)))
      if (hit) return hit.id
    }
  }
  return null
}
