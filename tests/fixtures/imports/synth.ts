import { cuitCheckDigit } from '@/lib/fiscal/cuit'
import { decodeWindows1252 } from '@/lib/imports/bytes'

/**
 * Generador SINTÉTICO de los archivos de importación (WP4). Lo usa
 * `scripts/imports/make-fixtures.mts` para escribir `tests/fixtures/imports/*` y
 * los tests para comparar: con la misma semilla da siempre los mismos textos.
 *
 * Nada sale de un archivo real: las CUIT son inventadas (con dígito verificador
 * válido), las razones sociales son de fantasía y los importes salen de un
 * generador pseudoaleatorio con semilla fija. Lo que sí copia de los archivos
 * reales de la investigación es la FORMA (`arca-mis-comprobantes.md` §3–§5 y
 * §9.5, `mercadopago.md` §1.2, `banco.md` §1–§3): columnas, separadores,
 * comillas, vacíos, codificación y los conteos de la tabla de §9.5 (filas, NC,
 * moneda extranjera, redondeos, faltantes por percepciones).
 */

// ─── Datos fijos ─────────────────────────────────────────────────────────────

/** La SAS de prueba (la misma de los fixtures de ARCA): 30-71234567-1. */
export const SAS_CUIT = '30712345671'
/** Quien consulta en ARCA (persona de prueba): 20-12345678-6. */
export const CONSULTOR_CUIT = '20123456786'
/** Una caja de prueba para las claves del banco. */
export const TREASURY_ID = '0b5e1d2c-3a4f-4e6d-8c7b-9a0f1e2d3c4b'

// ─── Azar con semilla ────────────────────────────────────────────────────────

export type Rng = {
  next(): number
  int(min: number, max: number): number
  chance(p: number): boolean
  pick<T>(list: readonly T[]): T
  shuffle<T>(list: T[]): T[]
}

/** mulberry32: chico, rápido y determinístico. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T,
    shuffle: <T>(list: T[]): T[] => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = list[i] as T
        list[i] = list[j] as T
        list[j] = tmp
      }
      return list
    },
  }
  return rng
}

// ─── CUIT, CBU, importes y fechas ────────────────────────────────────────────

/** Una CUIT válida con ese prefijo, a partir de un número (si el verificador no existe, el siguiente). */
export function makeCuit(prefix: string, body: number): string {
  for (let b = body; ; b++) {
    const first = `${prefix}${String(b % 100_000_000).padStart(8, '0')}`
    const dv = cuitCheckDigit(first)
    if (dv !== null) return `${first}${dv}`
  }
}

function cbuCheck(digits: string, weights: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++)
    sum += Number(digits[i]) * (weights[i % weights.length] ?? 0)
  return (10 - (sum % 10)) % 10
}

/** CBU/CVU de 22 dígitos con sus dos verificadores. */
export function makeCbu(entity7: string, account13: string): string {
  return `${entity7}${cbuCheck(entity7, [7, 1, 3, 9])}${account13}${cbuCheck(account13, [3, 9, 7, 1])}`
}

/** CBU propio en Banco Nación (entidad 011, sucursal 0123). */
export const OWN_CBU = makeCbu('0110123', '3000123456789')
/** CVU propio en Mercado Pago. */
export const OWN_CVU = makeCbu('0000003', '1000098765432')
/** El CBU de un proveedor (para un pago a un tercero). */
export const THIRD_CBU = makeCbu('0720456', '8800012345678')

/** 123456 → `'1234,56'` (coma decimal, sin miles: Mis Comprobantes). */
export function centsComma(c: number): string {
  const neg = c < 0
  const a = Math.abs(c)
  return `${neg ? '-' : ''}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
}

/** 123456 → `'1234.56'` (punto decimal: Mercado Pago). */
export function centsDot(c: number): string {
  return centsComma(c).replace(',', '.')
}

/** 123456789 → `'1.234.567,89'` (como lo muestra un banco). */
export function centsEsAr(c: number): string {
  const neg = c < 0
  const a = Math.abs(c)
  const int = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${int},${String(a % 100).padStart(2, '0')}`
}

/** `'2025-12-01'` → `'1/12/2025'` (como lo reescribe Excel). */
export function excelishDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}/${y}`
}

/** `'2025-12-01'` → `'01/12/2025'`. */
export function dmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function isoDay(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Los días entre dos fechas (incluidas), sin `Date` local. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const start = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  )
  const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    out.push(isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))
  }
  return out
}

/** Texto → bytes de Windows-1252 (tira si un carácter no existe en esa tabla). */
export function encodeCp1252(text: string): Uint8Array {
  const reverse = new Map<string, number>()
  for (let b = 0; b < 256; b++) reverse.set(decodeWindows1252(Uint8Array.of(b)), b)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const b = reverse.get(text[i] as string)
    if (b === undefined) throw new Error(`Carácter fuera de Windows-1252 en el fixture: ${text[i]}`)
    out[i] = b
  }
  return out
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// ─── Proveedores de fantasía ─────────────────────────────────────────────────

export type Supplier = {
  readonly cuit: string
  readonly name: string
  /** `ri` emite A/B; `mono` emite C. */
  readonly kind: 'ri' | 'mono'
  readonly pv: number
  /** Usa CAEA (el mismo código en muchas facturas). */
  readonly caea: string | null
}

const RUBROS = [
  'DISTRIBUIDORA',
  'BEBIDAS',
  'LACTEOS',
  'PANIFICADORA',
  'FRIGORIFICO',
  'VERDULERIA',
  'CERVECERIA',
  'VINOTECA',
  'SERVICIOS',
  'LIMPIEZA',
  'TECNOLOGIA',
  'IMPRENTA',
  'MAYORISTA',
  'ALMACEN',
  'CAFE',
  'HIELO',
  'DESCARTABLES',
  'SEGURIDAD',
  'FUMIGACIONES',
  'ELECTRICIDAD',
]
const LUGARES = [
  'DEL CENTRO',
  'EJEMPLO',
  'DEL SUR',
  'NORTE',
  'CORDOBESA',
  'LA ESQUINA',
  'SAN MARTÍN',
  'LOS ÁLAMOS',
  'DE PRUEBA',
  'LA ÑATA',
]
const FORMAS = ['S.A.', 'SRL', 'SAS', 'S.R.L.', 'SOCIEDAD ANONIMA']
const APELLIDOS = ['GOMEZ', 'PEREZ', 'RODRIGUEZ', 'FERNANDEZ', 'LOPEZ', 'DIAZ', 'MARTINEZ', 'SOSA']
const NOMBRES = ['ANA', 'JUAN', 'MARÍA', 'PEDRO', 'LUCÍA', 'JOSÉ', 'CARLA', 'NICOLÁS']

/** Un padrón de proveedores de fantasía (con nombres con coma, punto, tilde y Ñ). */
export function makeSuppliers(rng: Rng, count: number, monoShare = 0.2): Supplier[] {
  const out: Supplier[] = []
  const names = new Set<string>()
  for (let i = 0; out.length < count; i++) {
    const mono = rng.chance(monoShare)
    let name: string
    if (i === 0) name = 'FIDEICOMISO PRUEBA , PEREZ Y OTROS'
    else if (i === 1) name = 'CAFÉ & CÍA. S.A.'
    else if (mono)
      name =
        `${rng.pick(APELLIDOS)} ${rng.pick(NOMBRES)} ${rng.pick(['', 'ALBERTO', 'BEATRIZ'])}`.trim()
    else name = `${rng.pick(RUBROS)} ${rng.pick(LUGARES)} ${rng.pick(FORMAS)}`
    if (names.has(name)) continue
    names.add(name)
    const cuit = mono
      ? makeCuit(rng.pick(['20', '27', '23']), rng.int(10_000_000, 45_000_000))
      : makeCuit(rng.pick(['30', '33']), rng.int(50_000_000, 72_000_000))
    out.push({
      cuit,
      name,
      kind: mono ? 'mono' : 'ri',
      pv: rng.chance(0.15) ? rng.int(1000, 9999) : rng.int(1, 40),
      caea:
        !mono && i % 11 === 5
          ? `3${String(rng.int(1_000_000, 9_999_999))}${String(rng.int(100_000, 999_999))}`
          : null,
    })
  }
  return out
}

// ─── Mis Comprobantes: el modelo de una fila ─────────────────────────────────

export type RateKey = 'r0' | 'r25' | 'r5' | 'r105' | 'r21' | 'r27'
export const RATE_BP: Readonly<Record<RateKey, number>> = {
  r0: 0,
  r25: 250,
  r5: 500,
  r105: 1050,
  r21: 2100,
  r27: 2700,
}

export type SynthVoucher = {
  date: string
  code: number
  pv: number
  number: number
  numberTo: number
  cae: string
  issuerCuit: string
  issuerName: string
  receiverDocType: number
  receiverDoc: string
  receiverName: string
  currency: 'ARS' | 'USD'
  /** El tipo de cambio como lo escribe ARCA (`'1,00'`, `'1475,006'`). */
  rate: string
  /** Solo las alícuotas que tiene el comprobante. */
  net: Partial<Record<RateKey, number>>
  vat: Partial<Record<RateKey, number>>
  netTotal: number
  vatTotal: number
  /** `null` = celda vacía. */
  nonTaxed: number | null
  exempt: number | null
  otherTaxes: number
  total: number
  discriminated: boolean
}

/** Con IVA discriminado para quien recibe: A, M, tique A y recibos A. */
const DISCRIMINATED = new Set([1, 2, 3, 4, 51, 52, 53, 81])

function letterKind(code: number): 'ri' | 'mono' {
  return [11, 12, 13, 15, 211, 212, 213].includes(code) ? 'mono' : 'ri'
}

function vatOf(net: number, key: RateKey): number {
  return Math.round((net * RATE_BP[key]) / 10000)
}

type ResidualPlan = { max: number; zeroShare: number }

function residualFor(rng: Rng, plan: ResidualPlan): number {
  if (plan.max <= 0 || rng.chance(plan.zeroShare)) return 0
  const r = rng.int(1, Math.max(1, plan.max - 1))
  return rng.chance(0.5) ? r : -r
}

const SINGLE_RATE: ReadonlyArray<readonly RateKey[]> = [
  ['r21'],
  ['r21'],
  ['r21'],
  ['r105'],
  ['r27'],
]

const MIXES: ReadonlyArray<readonly RateKey[]> = [
  ['r21'],
  ['r21'],
  ['r21'],
  ['r21'],
  ['r105'],
  ['r21', 'r105'],
  ['r27'],
  ['r21', 'r0'],
  ['r105'],
  ['r21'],
]

export type McRecibidosSpec = {
  readonly seed: number
  readonly from: string
  readonly to: string
  /** Cuántos comprobantes de cada código. */
  readonly types: ReadonlyArray<readonly [number, number]>
  /** Facturas A en dólares. */
  readonly usdRows: number
  /** El mayor redondeo de ARCA (centavos): exactamente una fila lo tiene. */
  readonly maxRounding: number
  /** Facturas A con percepciones que ARCA NO pone en «Otros Tributos» (G2). */
  readonly gapRows?: number
  /** Facturas A con dos alícuotas (en G2 no se puede deducir la alícuota). */
  readonly mixedRows?: number
  /** B y C con «Otros Tributos» (legítimo: percepciones de una B). */
  readonly bcOtherTaxesRows?: number
  /** Filas a nombre de un DNI en vez de la CUIT de la SAS (G3). */
  readonly dniReceiverRows?: number
  readonly suppliers?: number
  /** Solo una alícuota por factura (salvo `mixedRows`): G2 no permite deducir mezclas. */
  readonly singleRate?: boolean
}

/**
 * Comprobantes recibidos de fantasía con la forma de los reales. Determinístico:
 * la misma especificación da siempre las mismas filas, ordenadas por fecha.
 */
export function makeRecibidos(spec: McRecibidosSpec): SynthVoucher[] {
  const rng = makeRng(spec.seed)
  const suppliers = makeSuppliers(rng, spec.suppliers ?? 60)
  const ri = suppliers.filter((s) => s.kind === 'ri')
  const mono = suppliers.filter((s) => s.kind === 'mono')
  const days = daysBetween(spec.from, spec.to)
  const codes: number[] = []
  for (const [code, n] of spec.types) for (let i = 0; i < n; i++) codes.push(code)
  rng.shuffle(codes)

  // Qué filas son especiales (por índice dentro de las de cada clase).
  const aIdx = codes.map((c, i) => (c === 1 ? i : -1)).filter((i) => i >= 0)
  const discIdx = codes.map((c, i) => (DISCRIMINATED.has(c) ? i : -1)).filter((i) => i >= 0)
  const bcIdx = codes.map((c, i) => (DISCRIMINATED.has(c) ? -1 : i)).filter((i) => i >= 0)
  const pool = rng.shuffle([...aIdx])
  const usd = new Set(pool.slice(0, spec.usdRows))
  const gap = new Set(pool.slice(spec.usdRows, spec.usdRows + (spec.gapRows ?? 0)))
  const mixed = new Set(
    pool.slice(
      spec.usdRows + (spec.gapRows ?? 0),
      spec.usdRows + (spec.gapRows ?? 0) + (spec.mixedRows ?? 0),
    ),
  )
  const bcOther = new Set(rng.shuffle([...bcIdx]).slice(0, spec.bcOtherTaxesRows ?? 0))
  const dni = new Set(rng.shuffle([...discIdx]).slice(0, spec.dniReceiverRows ?? 0))
  const maxRow = rng.shuffle(discIdx.filter((i) => !gap.has(i)))[0] ?? -1

  const used = new Set<string>()
  const counters = new Map<string, number>()
  const out: Array<SynthVoucher & { order: number }> = []
  codes.forEach((code, i) => {
    const issuer = letterKind(code) === 'mono' ? rng.pick(mono) : rng.pick(ri)
    const date = rng.pick(days)
    const counterKey = `${issuer.cuit}:${code}:${issuer.pv}`
    let number = (counters.get(counterKey) ?? rng.int(100, 2_000_000)) + rng.int(1, 40)
    while (used.has(`${counterKey}:${number}`)) number++
    used.add(`${counterKey}:${number}`)
    counters.set(counterKey, number)
    const cae =
      issuer.caea ?? `75${String(48_000_000_000 + i * 7919 + rng.int(0, 7000)).padStart(12, '0')}`

    const isUsd = usd.has(i)
    const v: SynthVoucher = {
      date,
      code,
      pv: issuer.pv,
      number,
      numberTo: number,
      cae,
      issuerCuit: issuer.cuit,
      issuerName: issuer.name,
      receiverDocType: dni.has(i) ? 96 : 80,
      receiverDoc: dni.has(i) ? String(rng.int(20_000_000, 45_000_000)) : SAS_CUIT,
      receiverName: '',
      currency: isUsd ? 'USD' : 'ARS',
      rate: isUsd ? rng.pick(['1451,00', '1475,006', '1465,0222', '1437,50', '1464,9392']) : '1,00',
      net: {},
      vat: {},
      netTotal: 0,
      vatTotal: 0,
      nonTaxed: 0,
      exempt: 0,
      otherTaxes: 0,
      total: 0,
      discriminated: DISCRIMINATED.has(code),
    }
    if (v.discriminated) {
      const mix = mixed.has(i)
        ? (['r21', 'r105'] as const)
        : isUsd
          ? (['r21'] as const)
          : rng.pick(spec.singleRate ? SINGLE_RATE : MIXES)
      for (const key of mix) {
        const net = isUsd ? rng.int(1_000, 60_000) : rng.int(50_000, 90_000_000)
        v.net[key] = net
        if (key !== 'r0') v.vat[key] = vatOf(net, key)
      }
      v.netTotal = Object.values(v.net).reduce((a, b) => a + (b ?? 0), 0)
      v.vatTotal = Object.values(v.vat).reduce((a, b) => a + (b ?? 0), 0)
      if (!isUsd && rng.chance(0.2)) v.otherTaxes = Math.round(v.netTotal * 0.03)
      if (rng.chance(0.17)) {
        v.nonTaxed = null
        v.exempt = null
      } else if (rng.chance(0.05)) {
        v.nonTaxed = rng.int(1_000, 200_000)
      }
      const residual =
        i === maxRow
          ? spec.maxRounding
          : residualFor(rng, { max: spec.maxRounding, zeroShare: 0.7 })
      const perceptionsNotShown = gap.has(i) ? Math.round(v.netTotal * 0.03) : 0
      v.total =
        v.netTotal +
        v.vatTotal +
        (v.nonTaxed ?? 0) +
        (v.exempt ?? 0) +
        v.otherTaxes +
        residual +
        perceptionsNotShown
    } else {
      v.total = rng.int(100_000, 120_000_000)
      if (bcOther.has(i)) {
        v.otherTaxes = Math.round(v.total * 0.025)
        v.total += v.otherTaxes
      }
    }
    out.push({ ...v, order: i })
  })
  out.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1))
  return out.map(({ order: _order, ...v }) => v)
}

// ─── Las especificaciones de los fixtures (§9.5) ─────────────────────────────

/** Recibidos dic-2025 (G3): 513 filas, 77 NC, 8 en USD, mayor redondeo $ 0,35. */
export const MC_DIC_SPEC: McRecibidosSpec = {
  seed: 202512,
  from: '2025-12-01',
  to: '2025-12-31',
  types: [
    [1, 370],
    [3, 76],
    [11, 49],
    [2, 10],
    [15, 3],
    [6, 2],
    [4, 2],
    [8, 1],
  ],
  usdRows: 8,
  maxRounding: 35,
}

/** Recibidos nov-2025 (G3): 539 filas, 75 NC, 12 en USD, mayor redondeo $ 0,55, 3 a nombre de un DNI. */
export const MC_NOV_SPEC: McRecibidosSpec = {
  seed: 202511,
  from: '2025-11-01',
  to: '2025-11-30',
  types: [
    [1, 386],
    [3, 75],
    [11, 51],
    [2, 17],
    [15, 6],
    [6, 2],
    [4, 2],
  ],
  usdRows: 12,
  maxRounding: 55,
  dniReceiverRows: 3,
}

/** Recibidos sep-24 → ago-25 (G2): 1094 filas, 39 NC, 12 en DOL, 112 con percepciones sin detallar, $ 0,04. */
export const MC_G2_RECIBIDOS_SPEC: McRecibidosSpec = {
  seed: 202508,
  from: '2024-09-01',
  to: '2025-08-24',
  types: [
    [1, 864],
    [6, 93],
    [11, 91],
    [3, 24],
    [8, 13],
    [2, 7],
    [13, 2],
  ],
  usdRows: 12,
  maxRounding: 4,
  gapRows: 112,
  mixedRows: 20,
  bcOtherTaxesRows: 5,
  singleRate: true,
}

/** Emitidos sep-24 → ago-25 (G2): 3543 filas, 25 NC, todo en pesos, $ 0,01. */
export const MC_G2_EMITIDOS_SPEC = {
  seed: 202509,
  from: '2024-09-01',
  to: '2025-08-24',
  types: [
    [6, 3270],
    [1, 248],
    [8, 21],
    [3, 4],
  ],
} as const

/** Un archivo chico (6 filas) para Windows-1252 y para el «pasado por Excel». */
export const MC_SMALL_SPEC: McRecibidosSpec = {
  seed: 7,
  from: '2025-12-01',
  to: '2025-12-05',
  types: [
    [1, 4],
    [3, 1],
    [11, 1],
  ],
  usdRows: 0,
  maxRounding: 3,
  suppliers: 6,
}

// ─── Mis Comprobantes: CSV G3, G2, G1 ────────────────────────────────────────

export const G3_RECIBIDOS_TITLES = [
  'Fecha de Emisión',
  'Tipo de Comprobante',
  'Punto de Venta',
  'Número Desde',
  'Número Hasta',
  'Cód. Autorización',
  'Tipo Doc. Emisor',
  'Nro. Doc. Emisor',
  'Denominación Emisor',
  'Tipo Doc. Receptor',
  'Nro. Doc. Receptor',
  'Tipo Cambio',
  'Moneda',
  'Imp. Neto Gravado IVA 0%',
  'IVA 2,5%',
  'Imp. Neto Gravado IVA 2,5%',
  'IVA 5%',
  'Imp. Neto Gravado IVA 5%',
  'IVA 10,5%',
  'Imp. Neto Gravado IVA 10,5%',
  'IVA 21%',
  'Imp. Neto Gravado IVA 21%',
  'IVA 27%',
  'Imp. Neto Gravado IVA 27%',
  'Imp. Neto Gravado Total',
  'Imp. Neto No Gravado',
  'Imp. Op. Exentas',
  'Otros Tributos',
  'Total IVA',
  'Imp. Total',
] as const

/** Los mismos títulos con «del Emisor» (variante real, IronWeb). */
export const G3_RECIBIDOS_TITLES_DEL_EMISOR = G3_RECIBIDOS_TITLES.map((t) =>
  t.replace(' Emisor', ' del Emisor'),
)

export const G2_RECIBIDOS_TITLES = [
  'Fecha de Emisión',
  'Tipo de Comprobante',
  'Punto de Venta',
  'Número Desde',
  'Número Hasta',
  'Cód. Autorización',
  'Tipo Doc. Emisor',
  'Nro. Doc. Emisor',
  'Denominación Emisor',
  'Tipo Cambio',
  'Moneda',
  'Imp. Neto Gravado',
  'Imp. Neto No Gravado',
  'Imp. Op. Exentas',
  'Otros Tributos',
  'IVA',
  'Imp. Total',
] as const

export const G2_EMITIDOS_TITLES = G2_RECIBIDOS_TITLES.map((t) => t.replace('Emisor', 'Receptor'))

const cell = (v: number | null | undefined, fmt: (c: number) => string): string =>
  v === null || v === undefined ? '' : fmt(v)

/** Los 16 importes de G3 en el orden de las columnas 14 a 29. */
function g3Amounts(v: SynthVoucher, fmt: (c: number) => string): string[] {
  if (!v.discriminated) {
    // B, C y recibos C: los 16 componentes en 0,00 y solo el total (§3.4); «Otros
    // Tributos» (el anteúltimo) puede traer percepciones de una B.
    return [...(Array(14).fill(fmt(0)) as string[]), fmt(v.otherTaxes), fmt(0)]
  }
  const n = (k: RateKey) => cell(v.net[k], fmt)
  const t = (k: RateKey) => cell(v.vat[k], fmt)
  return [
    n('r0'),
    t('r25'),
    n('r25'),
    t('r5'),
    n('r5'),
    t('r105'),
    n('r105'),
    t('r21'),
    n('r21'),
    t('r27'),
    n('r27'),
    fmt(v.netTotal),
    cell(v.nonTaxed, fmt),
    cell(v.exempt, fmt),
    fmt(v.otherTaxes),
    fmt(v.vatTotal),
  ]
}

const quoted = (titles: readonly string[], sep: string) => titles.map((t) => `"${t}"`).join(sep)

/** CSV G3 de Recibidos como lo baja ARCA: `;`, títulos entre comillas, datos sin comillas, LF. */
export function g3RecibidosCsv(
  rows: readonly SynthVoucher[],
  opts: {
    titles?: readonly string[]
    currency?: { ars: string; usd: string }
    excel?: boolean
    eol?: string
  } = {},
): string {
  const titles = opts.titles ?? G3_RECIBIDOS_TITLES
  const eol = opts.eol ?? '\n'
  const cur = opts.currency ?? { ars: '$', usd: 'USD' }
  // «Pasado por Excel»: títulos sin comillas, fechas d/m/aaaa y el CAE en notación científica.
  const head = opts.excel ? titles.join(';') : quoted(titles, ';')
  const lines = rows.map((v) => {
    const cae = opts.excel ? `${v.cae.slice(0, 1)},${v.cae.slice(1, 6)}E+13` : v.cae
    return [
      opts.excel ? excelishDate(v.date) : v.date,
      v.code,
      v.pv,
      v.number,
      v.numberTo,
      cae,
      80,
      v.issuerCuit,
      v.issuerName,
      v.receiverDocType,
      v.receiverDoc,
      v.rate,
      v.currency === 'USD' ? cur.usd : cur.ars,
      ...g3Amounts(v, centsComma),
      centsComma(v.total),
    ].join(';')
  })
  return `${[head, ...lines].join(eol)}${eol}`
}

/** CSV G2 (oct-2023 → ago-2025): 17 columnas, `PES`/`DOL`, un solo neto y un solo IVA. */
export function g2Csv(rows: readonly SynthVoucher[], kind: 'recibidos' | 'emitidos'): string {
  const titles = kind === 'recibidos' ? G2_RECIBIDOS_TITLES : G2_EMITIDOS_TITLES
  const lines = rows.map((v) =>
    [
      v.date,
      v.code,
      v.pv,
      v.number,
      v.numberTo,
      v.cae,
      kind === 'recibidos' ? 80 : v.receiverDocType,
      kind === 'recibidos' ? v.issuerCuit : v.receiverDoc,
      kind === 'recibidos' ? v.issuerName : v.receiverName,
      v.rate,
      v.currency === 'USD' ? 'DOL' : 'PES',
      centsComma(v.discriminated ? v.netTotal : 0),
      cell(v.discriminated ? v.nonTaxed : 0, centsComma),
      cell(v.discriminated ? v.exempt : 0, centsComma),
      centsComma(v.otherTaxes),
      centsComma(v.discriminated ? v.vatTotal : 0),
      centsComma(v.total),
    ].join(';'),
  )
  return `${[quoted(titles, ';'), ...lines].join('\n')}\n`
}

/** Emitidos G2 de un bar responsable inscripto: B a consumidor final, A a empresas y algunas NC. */
export function makeEmitidos(spec: {
  seed: number
  from: string
  to: string
  types: ReadonlyArray<readonly [number, number]>
}): SynthVoucher[] {
  const rng = makeRng(spec.seed)
  const days = daysBetween(spec.from, spec.to)
  const companies = makeSuppliers(rng, 30, 0).map((s) => ({ cuit: s.cuit, name: s.name }))
  const tickets = [
    1800, 2500, 3200, 4500, 5200, 6100, 7400, 8900, 9600, 11200, 12800, 14500, 16900, 18300, 21000,
    23400, 25900, 28600, 31200, 35800, 41000, 47500, 52300, 61800, 74900,
  ].map((p) => p * 100)
  const codes: number[] = []
  for (const [code, n] of spec.types) for (let i = 0; i < n; i++) codes.push(code)
  rng.shuffle(codes)
  const next = new Map<string, number>()
  const rows = codes.map((code, i) => {
    const isA = code === 1 || code === 3
    const pv = isA ? 3 : rng.pick([1, 2, 4])
    const k = `${code}:${pv}`
    const number = (next.get(k) ?? 0) + 1
    next.set(k, number)
    const total = isA ? rng.pick(tickets) * rng.int(2, 12) : rng.pick(tickets)
    const net = Math.round((total * 100) / 121)
    const vat = Math.round((net * 21) / 100)
    const company = rng.pick(companies)
    const consumer = rng.chance(0.06)
    const cuil = !isA && i === 7
    return {
      v: {
        date: rng.pick(days),
        code,
        pv,
        number,
        numberTo: number,
        cae: `74${String(36_000_000_000 + i * 3 + rng.int(0, 2)).padStart(12, '0')}`,
        issuerCuit: SAS_CUIT,
        issuerName: 'BAR DE PRUEBA SAS',
        receiverDocType: isA ? 80 : cuil ? 86 : consumer ? 99 : 96,
        receiverDoc: isA
          ? company.cuit
          : cuil
            ? makeCuit('20', 30_000_000 + i)
            : consumer
              ? '0'
              : String(rng.int(20_000_000, 45_000_000)),
        receiverName: isA
          ? company.name
          : consumer
            ? ''
            : `CLIENTE DE PRUEBA ${String(i % 400).padStart(3, '0')}`,
        currency: 'ARS' as const,
        rate: '1,00',
        net: { r21: net },
        vat: { r21: vat },
        netTotal: net,
        vatTotal: vat,
        nonTaxed: 0,
        exempt: 0,
        otherTaxes: 0,
        // El redondeo sale solo: neto e IVA redondeados por separado (± 1 centavo).
        total,
        discriminated: true,
      } satisfies SynthVoucher,
      order: i,
    }
  })
  rows.sort((a, b) => (a.v.date === b.v.date ? a.order - b.order : a.v.date < b.v.date ? -1 : 1))
  // Numeración en orden de fecha, como la asigna ARCA.
  const renumber = new Map<string, number>()
  return rows.map(({ v }) => {
    const k = `${v.code}:${v.pv}`
    const n = (renumber.get(k) ?? 0) + 1
    renumber.set(k, n)
    return { ...v, number: n, numberTo: n }
  })
}

/** CSV G1 (hasta ~oct-2023): `,`, TODO entre comillas, punto decimal, tipo con texto, ceros a la izquierda, CRLF. */
export function g1RecibidosCsv(): string {
  const titles = [
    'Fecha',
    'Tipo',
    'Punto de Venta',
    'Número Desde',
    'Número Hasta',
    'Cód. Autorización',
    'Tipo Doc. Emisor',
    'Nro. Doc. Emisor',
    'Denominación Emisor',
    'Tipo Cambio',
    'Moneda',
    'Imp. Neto Gravado',
    'Imp. Neto No Gravado',
    'Imp. Op. Exentas',
    'IVA',
    'Imp. Total',
  ]
  const issuer = makeCuit('30', 61_234_567)
  const row = [
    '15/03/2022',
    '1 - Factura A',
    '00002',
    '00000123',
    '00000123',
    '72111111111111',
    'CUIT',
    issuer,
    'PROVEEDOR, UNO SA',
    '1',
    '$',
    '100.00',
    '',
    '',
    '21.00',
    '121.00',
  ]
  const q = (cells: readonly string[]) => cells.map((c) => `"${c}"`).join(',')
  return `${q(titles)}\r\n${q(row)}\r\n`
}

// ─── Portal IVA (CSV de compras del Libro IVA Digital) ───────────────────────

export const PORTAL_IVA_TITLES = [
  'Fecha de Emisión',
  'Tipo de Comprobante',
  'Punto de Venta',
  'Número de Comprobante',
  'Tipo Doc. Vendedor',
  'Nro. Doc. Vendedor',
  'Denominación Vendedor',
  'Importe Total',
  'Moneda Original',
  'Tipo de Cambio',
  'Importe No Gravado',
  'Importe Exento',
  'Crédito Fiscal Computable',
  'Importe de Per. o Pagos a Cta. de Otros Imp. Nac.',
  'Importe de Percepciones de Ingresos Brutos',
  'Importe de Impuestos Municipales',
  'Importe de Percepciones o Pagos a Cuenta de IVA',
  'Importe de Impuestos Internos',
  'Importe Otros Tributos',
  'Neto Gravado IVA 0%',
  'Neto Gravado IVA 2,5%',
  'Importe IVA 2,5%',
  'Neto Gravado IVA 5%',
  'Importe IVA 5%',
  'Neto Gravado IVA 10,5%',
  'Importe IVA 10,5%',
  'Neto Gravado IVA 21%',
  'Importe IVA 21%',
  'Neto Gravado IVA 27%',
  'Importe IVA 27%',
  'Total Neto Gravado',
  'Total IVA',
] as const

/** CSV de compras de Portal IVA: `;`, títulos y textos entre comillas, coma decimal. */
export function portalIvaCsv(seed: number, rowsCount: number, maxRounding: number): string {
  const rng = makeRng(seed)
  const suppliers = makeSuppliers(rng, 12, 0.1)
  const ri = suppliers.filter((x) => x.kind === 'ri')
  const lines: string[] = []
  for (let i = 0; i < rowsCount; i++) {
    // La fila 1 lleva el mayor redondeo: tiene que ser una A.
    const s = i === 1 ? (ri[0] as Supplier) : rng.pick(suppliers)
    const code = s.kind === 'mono' ? 11 : i % 5 === 4 && i !== 1 ? 6 : 1
    const disc = code === 1
    const net = rng.int(100_000, 40_000_000)
    const vat = disc ? vatOf(net, 'r21') : 0
    const percOtros = disc && i % 3 === 0 ? Math.round(net * 0.03) : 0
    const percIibb = disc && i % 4 === 1 ? Math.round(net * 0.02) : 0
    const residual = i === 1 ? maxRounding : disc ? rng.int(-2, 2) : 0
    const total = disc ? net + vat + percOtros + percIibb + residual : rng.int(100_000, 9_000_000)
    const amt = (v: number) => centsComma(v)
    lines.push(
      [
        `2025-10-${String(1 + ((i * 3) % 28)).padStart(2, '0')}`,
        code,
        s.pv,
        1000 + i * 37,
        80,
        s.cuit,
        `"${s.name}"`,
        amt(total),
        '"PES"',
        '1,00',
        amt(0),
        amt(0),
        amt(vat),
        amt(percOtros),
        amt(percIibb),
        amt(0),
        amt(0),
        amt(0),
        amt(0),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        disc ? amt(net) : '',
        disc ? amt(vat) : '',
        '',
        '',
        disc ? amt(net) : amt(0),
        disc ? amt(vat) : amt(0),
      ].join(';'),
    )
  }
  return `${[quoted(PORTAL_IVA_TITLES, ';'), ...lines].join('\n')}\n`
}

// ─── XLSX mínimo ─────────────────────────────────────────────────────────────

/** Una celda para el escritor de XLSX. */
export type XCell =
  | null
  | { t: 's'; v: string }
  | { t: 'n'; v: number; s?: number }
  | { t: 'inline'; v: string }
  | { t: 'str'; v: string }
  | { t: 'b'; v: boolean }
  | { t: 'e'; v: string }
  | { t: 'rich'; runs: readonly string[]; phonetic?: string }

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * Las partes de un `.xlsx` con una hoja (como las escribe Excel: texto
 * compartido, estilos con formatos de fecha, una fila de título combinada).
 * Estilos: 0 general · 1 fecha (numFmtId 14) · 2 fecha propia `dd/mm/yyyy` ·
 * 3 número `#,##0.00` · 4 el formato «que se come el punto» de `Tipo Cambio`.
 */
export function xlsxParts(opts: {
  sheetName: string
  rows: readonly (readonly XCell[])[]
  merge?: string
  date1904?: boolean
  /** Sin el atributo `r` en filas y celdas (otros generadores lo omiten). */
  omitRefs?: boolean
}): Record<string, string> {
  const shared: string[] = []
  const sharedIdx = new Map<string, number>()
  const sst = (s: string) => {
    let i = sharedIdx.get(s)
    if (i === undefined) {
      i = shared.length
      shared.push(`<si><t xml:space="preserve">${esc(s)}</t></si>`)
      sharedIdx.set(s, i)
    }
    return i
  }
  const rowsXml = opts.rows
    .map((row, r) => {
      const cells = row
        .map((c, j) => {
          if (c === null) return ''
          const ref = opts.omitRefs ? '' : ` r="${colName(j)}${r + 1}"`
          switch (c.t) {
            case 's':
              return `<c${ref} t="s"><v>${sst(c.v)}</v></c>`
            case 'n':
              return `<c${ref}${c.s ? ` s="${c.s}"` : ''}><v>${c.v}</v></c>`
            case 'inline':
              return `<c${ref} t="inlineStr"><is><t>${esc(c.v)}</t></is></c>`
            case 'str':
              return `<c${ref} t="str"><f>"${esc(c.v)}"</f><v>${esc(c.v)}</v></c>`
            case 'b':
              return `<c${ref} t="b"><v>${c.v ? 1 : 0}</v></c>`
            case 'e':
              return `<c${ref} t="e"><v>${esc(c.v)}</v></c>`
            case 'rich': {
              const i = shared.length
              const runs = c.runs
                .map(
                  (t, k) =>
                    `<r>${k === 0 ? '<rPr><b/></rPr>' : '<rPr><sz val="11"/></rPr>'}<t xml:space="preserve">${esc(t)}</t></r>`,
                )
                .join('')
              const ph = c.phonetic
                ? `<rPh sb="0" eb="1"><t>${esc(c.phonetic)}</t></rPh><phoneticPr fontId="1"/>`
                : ''
              shared.push(`<si>${runs}${ph}</si>`)
              return `<c${ref} t="s"><v>${i}</v></c>`
            }
            default:
              return ''
          }
        })
        .join('')
      return `<row${opts.omitRefs ? '' : ` r="${r + 1}"`}>${cells}</row>`
    })
    .join('')
  const merge = opts.merge
    ? `<mergeCells count="1"><mergeCell ref="${opts.merge}"/></mergeCells>`
    : ''
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${ns}" xmlns:r="${rel}"><workbookPr${opts.date1904 ? ' date1904="1"' : ''} defaultThemeVersion="164011"/><sheets><sheet name="${esc(opts.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${ns}"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${ns}" count="${shared.length}" uniqueCount="${shared.length}">${shared.join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${ns}" xmlns:r="${rel}"><sheetData>${rowsXml}</sheetData>${merge}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`,
  }
}

/** Serial de Excel (sistema 1900) de un día ISO. */
export function excelSerial(iso: string): number {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round(t / 86_400_000) + 25569
}

/** El Excel G3 de Mis Comprobantes: fila 1 título combinado, fila 2 títulos cortos, 3 comprobantes (1 NC). */
export function mcExcelRows(): XCell[][] {
  const s = (v: string): XCell => ({ t: 's', v })
  const n = (v: number, st?: number): XCell => (st ? { t: 'n', v, s: st } : { t: 'n', v })
  const issuer = makeCuit('30', 55_667_788)
  const mono = makeCuit('20', 32_964_233)
  const titles = [
    'Fecha',
    'Tipo',
    'Punto de Venta',
    'Número Desde',
    'Número Hasta',
    'Cód. Autorización',
    'Tipo Doc. Emisor',
    'Nro. Doc. Emisor',
    'Denominación Emisor',
    'Tipo Doc. Receptor',
    'Nro. Doc. Receptor',
    'Tipo Cambio',
    'Moneda',
    'Neto Grav. IVA 0%',
    'IVA 2,5%',
    'Neto Grav. IVA 2,5%',
    'IVA 5%',
    'Neto Grav. IVA 5%',
    'IVA 10,5%',
    'Neto Grav. IVA 10,5%',
    'IVA 21%',
    'Neto Grav. IVA 21%',
    'IVA 27%',
    'Neto Grav. IVA 27%',
    'Neto Gravado Total',
    'Neto No Gravado',
    'Op. Exentas',
    'Otros Tributos',
    'Total IVA',
    'Imp. Total',
  ]
  const blanks = (k: number): XCell[] => Array(k).fill(null) as XCell[]
  return [
    [s(`Mis Comprobantes Recibidos - CUIT ${SAS_CUIT}`)],
    titles.map(s),
    [
      s('01/12/2025'),
      s('1 - Factura A'),
      n(3),
      n(110266),
      n(110266),
      n(75483269557186),
      s('CUIT'),
      s(issuer),
      { t: 'rich', runs: ['DISTRIBUIDORA ', 'EJEMPLO & CÍA SA'], phonetic: 'ディストリ' },
      s('CUIT'),
      s(SAS_CUIT),
      n(1, 4),
      s('$'),
      ...blanks(7),
      n(5814.05, 3),
      n(27685.95, 3),
      null,
      null,
      n(27685.95, 3),
      n(0, 3),
      n(0, 3),
      n(0, 3),
      n(5814.05, 3),
      n(33500, 3),
    ],
    [
      n(excelSerial('2025-12-02'), 2),
      s('3 - Nota de Crédito A'),
      n(4),
      n(1163),
      n(1163),
      n(75486929416798),
      s('CUIT'),
      s(issuer),
      s('DISTRIBUIDORA EJEMPLO & CÍA SA'),
      s('CUIT'),
      s(SAS_CUIT),
      n(1, 4),
      { t: 'str', v: '$' },
      ...blanks(7),
      n(3869.77, 3),
      n(18427.5, 3),
      null,
      null,
      n(18427.5, 3),
      n(0, 3),
      n(0, 3),
      n(0, 3),
      n(3869.77, 3),
      n(22297.27, 3),
    ],
    [
      s('03/12/2025'),
      s('11 - Factura C'),
      n(2),
      n(168),
      n(168),
      s('75481927731455'),
      s('CUIT'),
      s(mono),
      { t: 'inline', v: 'MONOTRIBUTISTA DE PRUEBA' },
      s('CUIT'),
      s(SAS_CUIT),
      n(1),
      s('$'),
      ...Array.from({ length: 16 }, (): XCell => n(0, 3)),
      n(255000, 3),
    ],
  ]
}

// ─── Mercado Pago: reporte de Liquidaciones ──────────────────────────────────

export type MpSynthRow = {
  date: string
  sourceId: string
  externalReference?: string
  recordType: 'initial_available_balance' | 'release' | 'total' | 'available_balance'
  description: string
  credit: number
  debit: number
  gross: number
  fee?: number
  taxes?: Array<{ entity: string; detail: string; amount: number }>
  approval?: string
  paymentMethod?: string
  paymentMethodType?: string
  operationTags?: string
  businessUnit?: string
  subUnit?: string
  posId?: string
  storeId?: string
  poiId?: string
  payoutAccount?: string
  payerType?: string
  payerNumber?: string
}

/**
 * Tres días de un bar con todo lo que puede aparecer: cobros QR, Point (con y
 * sin SIRTAC), uno de madrugada (para el día de servicio), transferencias de un
 * tercero (SIRCUPA) y de la propia CUIT, un par de reservas, un retiro propio y
 * un pago a un tercero con su impuesto, rendimientos, IIBB cobrado después,
 * propina, devolución, una percepción y un movimiento desconocido.
 */
export function mpReleaseRows(): MpSynthRow[] {
  const d = (day: number, time: string) => `2026-10-0${day}T${time}.000-03:00`
  const pay = (
    day: number,
    time: string,
    id: string,
    gross: number,
    fee: number,
    taxes: MpSynthRow['taxes'],
    extra: Partial<MpSynthRow>,
  ): MpSynthRow => {
    const t = (taxes ?? []).reduce((a, x) => a + x.amount, 0)
    return {
      date: d(day, time),
      approval: d(day, time),
      sourceId: id,
      recordType: 'release',
      description: 'payment',
      credit: gross + fee + t,
      debit: 0,
      gross,
      fee,
      taxes,
      ...extra,
    }
  }
  const qr = {
    operationTags: 'QR',
    businessUnit: 'Mercado Pago',
    subUnit: 'QR',
    posId: '40001',
    storeId: '50001',
    paymentMethodType: 'account_money',
    paymentMethod: 'account_money',
  }
  const ley = (amount: number) => ({
    entity: 'debitos_creditos',
    detail: 'tax_withholding_collector',
    amount,
  })
  const move = (
    day: number,
    time: string,
    id: string,
    description: string,
    signed: number,
    extra: Partial<MpSynthRow> = {},
  ): MpSynthRow => ({
    date: d(day, time),
    sourceId: id,
    recordType: 'release',
    description,
    credit: signed > 0 ? signed : 0,
    debit: signed < 0 ? -signed : 0,
    gross: signed,
    ...extra,
  })
  const initial: MpSynthRow = {
    date: d(1, '00:00:00'),
    sourceId: '',
    recordType: 'initial_available_balance',
    description: '',
    credit: 15_000_000,
    debit: 0,
    gross: 15_000_000,
  }
  return [
    initial,
    pay(1, '13:05:12', '91000000001', 6_780_000, -65_766, [ley(-40_680)], qr),
    pay(
      1,
      '14:20:00',
      '91000000002',
      2_500_000,
      -24_250,
      [ley(-15_000), { entity: 'cordoba', detail: 'tax_withholding_sirtac', amount: -25_000 }],
      qr,
    ),
    pay(1, '15:45:30', '91000000003', 1_800_000, -14_400, [ley(-10_800)], {
      operationTags: 'PO',
      poiId: 'PAX-0001-SYN',
      paymentMethodType: 'debit_card',
      paymentMethod: 'debvisa',
    }),
    pay(
      1,
      '19:10:00',
      '91000000004',
      5_000_000,
      0,
      [ley(-30_000), { entity: 'cordoba', detail: 'tax_withholding_sircupa', amount: -15_000 }],
      {
        paymentMethodType: 'bank_transfer',
        paymentMethod: 'cvu',
        payerType: 'DNI',
        payerNumber: '23456789',
      },
    ),
    pay(1, '20:00:00', '91000000005', 20_000_000, 0, [], {
      paymentMethodType: 'bank_transfer',
      paymentMethod: 'cvu',
      payerType: 'CUIT',
      payerNumber: SAS_CUIT,
    }),
    pay(2, '02:30:00', '91000000006', 900_000, -8_730, [ley(-5_400)], qr),
    move(2, '09:00:00', '92000000001', 'reserve_for_payout', -10_000_000),
    move(2, '09:00:01', '92000000001', 'reserve_for_payout', 10_000_000),
    move(2, '09:00:02', '92000000001', 'payout', -10_000_000, {
      externalReference: 'COELSA-SYN-0001',
      payoutAccount: OWN_CBU,
    }),
    move(2, '11:30:00', '92000000002', 'payout', -3_500_000, {
      externalReference: 'COELSA-SYN-0002',
      payoutAccount: THIRD_CBU,
    }),
    move(2, '11:30:01', '92000000002', 'tax_withholding_payout', -21_000),
    move(1, '23:59:00', '93000000001', 'asset_management', 4_512),
    move(2, '23:59:00', '93000000002', 'asset_management', 5_130),
    move(3, '10:00:00', '94000000001', 'tax_withdholding', -12_000),
    move(3, '12:15:00', '91000000007', 'tip', 150_000, { ...qr }),
    move(3, '16:40:00', '91000000001', 'refund', -200_000),
    move(3, '18:00:00', '95000000001', 'tax_iva', -320_000),
    move(3, '21:00:00', '96000000001', 'promo_bonus', 10_000),
    move(3, '23:59:00', '93000000003', 'asset_management', 3_877),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

const MP_COLUMNS = [
  'DATE',
  'SOURCE_ID',
  'EXTERNAL_REFERENCE',
  'RECORD_TYPE',
  'DESCRIPTION',
  'NET_CREDIT_AMOUNT',
  'NET_DEBIT_AMOUNT',
  'GROSS_AMOUNT',
  'BALANCE_AMOUNT',
  'MP_FEE_AMOUNT',
  'FINANCING_FEE_AMOUNT',
  'SHIPPING_FEE_AMOUNT',
  'COUPON_AMOUNT',
  'EFFECTIVE_COUPON_AMOUNT',
  'TAXES_AMOUNT',
  'TAX_DETAIL',
  'TAXES_DISAGGREGATED',
  'TRANSACTION_DATE',
  'TRANSACTION_APPROVAL_DATE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'INSTALLMENTS',
  'OPERATION_TAGS',
  'BUSINESS_UNIT',
  'SUB_UNIT',
  'SEGMENT_DETAIL',
  'POS_ID',
  'POS_NAME',
  'EXTERNAL_POS_ID',
  'STORE_ID',
  'STORE_NAME',
  'EXTERNAL_STORE_ID',
  'POI_ID',
  'POI_WALLET_NAME',
  'POI_BANK_NAME',
  'PAYOUT_BANK_ACCOUNT_NUMBER',
  'CURRENCY',
  'ORDER_ID',
  'ORDER_MP',
  'TRANSACTION_INTENT_ID',
  'METADATA',
  'PAYER_ID_TYPE',
  'PAYER_ID_NUMBER',
] as const

/** `[{financial_entity:debitos_creditos,amount:-406.80,detail:…}]`, sin comillas como lo manda MP. */
function taxesLoose(taxes: MpSynthRow['taxes']): string {
  if (!taxes || taxes.length === 0) return '[]'
  return `[${taxes
    .map((t) => `{financial_entity:${t.entity},amount:${centsDot(t.amount)},detail:${t.detail}}`)
    .join(',')}]`
}

function taxesJson(taxes: MpSynthRow['taxes']): string {
  return JSON.stringify(
    (taxes ?? []).map((t) => ({
      financial_entity: t.entity,
      amount: Number(centsDot(t.amount)),
      detail: t.detail,
    })),
  )
}

/** Saldo corrido y fila `total` para la lista de movimientos. */
function withBalances(rows: readonly MpSynthRow[]): Array<MpSynthRow & { balance: number }> {
  let balance = 0
  let credits = 0
  let debits = 0
  const out: Array<MpSynthRow & { balance: number }> = []
  for (const r of rows) {
    if (r.recordType === 'initial_available_balance') balance = r.credit - r.debit
    else balance += r.credit - r.debit
    credits += r.credit
    debits += r.debit
    out.push({ ...r, balance })
  }
  const last = rows[rows.length - 1]
  out.push({
    date: last ? last.date.replace(/T.*/, 'T23:59:59.000-03:00') : '',
    sourceId: '',
    recordType: 'total',
    description: '',
    credit: credits,
    debit: debits,
    gross: credits - debits,
    balance,
  })
  return out
}

/** CSV de Liquidaciones como lo deja la configuración de la guía: `,`, inglés, punto decimal, GMT-3. */
export function mpReleaseCsv(rows: readonly MpSynthRow[] = mpReleaseRows()): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = withBalances(rows).map((r) => {
    const taxes = (r.taxes ?? []).reduce((a, t) => a + t.amount, 0)
    const values: Record<(typeof MP_COLUMNS)[number], string> = {
      DATE: r.date,
      SOURCE_ID: r.sourceId,
      EXTERNAL_REFERENCE: r.externalReference ?? '',
      RECORD_TYPE: r.recordType,
      DESCRIPTION: r.description,
      NET_CREDIT_AMOUNT: centsDot(r.credit),
      NET_DEBIT_AMOUNT: centsDot(r.debit),
      GROSS_AMOUNT: centsDot(r.gross),
      BALANCE_AMOUNT: centsDot(r.balance),
      MP_FEE_AMOUNT: centsDot(r.fee ?? 0),
      FINANCING_FEE_AMOUNT: centsDot(0),
      SHIPPING_FEE_AMOUNT: centsDot(0),
      COUPON_AMOUNT: centsDot(0),
      EFFECTIVE_COUPON_AMOUNT: centsDot(0),
      TAXES_AMOUNT: centsDot(taxes),
      TAX_DETAIL: taxes !== 0 ? 'tax_debitos_creditos' : '',
      TAXES_DISAGGREGATED: r.recordType === 'release' ? taxesLoose(r.taxes) : '',
      TRANSACTION_DATE: r.approval ?? '',
      TRANSACTION_APPROVAL_DATE: r.approval ?? '',
      PAYMENT_METHOD: r.paymentMethod ?? '',
      PAYMENT_METHOD_TYPE: r.paymentMethodType ?? '',
      INSTALLMENTS: r.description === 'payment' ? '1' : '',
      OPERATION_TAGS: r.operationTags ?? '',
      BUSINESS_UNIT: r.businessUnit ?? '',
      SUB_UNIT: r.subUnit ?? '',
      SEGMENT_DETAIL: '',
      POS_ID: r.posId ?? '',
      POS_NAME: r.posId ? 'Caja barra' : '',
      EXTERNAL_POS_ID: r.posId ? 'BARRA01' : '',
      STORE_ID: r.storeId ?? '',
      STORE_NAME: r.storeId ? 'Bar de prueba' : '',
      EXTERNAL_STORE_ID: r.storeId ? 'LOCAL01' : '',
      POI_ID: r.poiId ?? '',
      POI_WALLET_NAME: '',
      POI_BANK_NAME: '',
      PAYOUT_BANK_ACCOUNT_NUMBER: r.payoutAccount ?? '',
      CURRENCY: 'ARS',
      ORDER_ID: '',
      ORDER_MP: '',
      TRANSACTION_INTENT_ID: '',
      METADATA: r.description === 'payment' ? '{}' : '',
      PAYER_ID_TYPE: r.payerType ?? '',
      PAYER_ID_NUMBER: r.payerNumber ?? '',
    }
    return MP_COLUMNS.map((c) => q(values[c])).join(',')
  })
  return `${[MP_COLUMNS.join(','), ...lines].join('\n')}\n`
}

/**
 * La variante «del panel»: `;`, menos columnas (sin la cuenta destino ni quién
 * pagó), el JSON de impuestos con comillas y sin encerrar, horario GMT-4 de
 * fábrica y la etiqueta vieja `withdrawal`.
 */
export function mpPanelCsv(): string {
  const cols = [
    'DATE',
    'SOURCE_ID',
    'EXTERNAL_REFERENCE',
    'RECORD_TYPE',
    'DESCRIPTION',
    'NET_CREDIT_AMOUNT',
    'NET_DEBIT_AMOUNT',
    'GROSS_AMOUNT',
    'MP_FEE_AMOUNT',
    'FINANCING_FEE_AMOUNT',
    'SHIPPING_FEE_AMOUNT',
    'TAXES_AMOUNT',
    'COUPON_AMOUNT',
    'INSTALLMENTS',
    'PAYMENT_METHOD',
    'BALANCE_AMOUNT',
    'TAXES_DISAGGREGATED',
    'OPERATION_TAGS',
    'POS_ID',
    'STORE_ID',
  ]
  const tz = (day: number, time: string) => `2026-10-0${day}T${time}.000-04:00`
  const rows: Array<Array<string>> = []
  let balance = 2_000_000
  const push = (
    date: string,
    id: string,
    record: string,
    desc: string,
    credit: number,
    debit: number,
    gross: number,
    fee: number,
    taxes: MpSynthRow['taxes'],
    method: string,
    tags: string,
    pos: string,
    store: string,
  ) => {
    if (record === 'release') balance += credit - debit
    const t = (taxes ?? []).reduce((a, x) => a + x.amount, 0)
    rows.push([
      date,
      id,
      '',
      record,
      desc,
      centsDot(credit),
      centsDot(debit),
      centsDot(gross),
      centsDot(fee),
      '0.00',
      '0.00',
      centsDot(t),
      '0.00',
      record === 'release' && desc === 'payment' ? '1' : '',
      method,
      centsDot(balance),
      record === 'release' ? taxesJson(taxes) : '',
      tags,
      pos,
      store,
    ])
  }
  push(
    tz(4, '00:00:00'),
    '',
    'initial_available_balance',
    '',
    2_000_000,
    0,
    2_000_000,
    0,
    [],
    '',
    '',
    '',
    '',
  )
  // 23:30 en GMT-4 = 00:30 del 5 en Córdoba: con corte a las 5 cuenta para el 4.
  push(
    tz(4, '23:30:00'),
    '97000000001',
    'release',
    'payment',
    1_945_100,
    0,
    2_000_000,
    -42_900,
    [{ entity: 'debitos_creditos', detail: 'tax_withholding_collector', amount: -12_000 }],
    'account_money',
    'QR',
    '40001',
    '50001',
  )
  push(
    tz(5, '10:00:00'),
    '97000000002',
    'release',
    'withdrawal',
    0,
    1_000_000,
    -1_000_000,
    0,
    [],
    '',
    '',
    '',
    '',
  )
  const last = balance
  rows.push([
    tz(5, '23:59:59'),
    '',
    '',
    'total',
    '',
    centsDot(2_000_000 + 1_945_100),
    centsDot(1_000_000),
    centsDot(last),
    '0.00',
    '0.00',
    '0.00',
    '0.00',
    '0.00',
    '',
    '',
    centsDot(last),
    '',
    '',
    '',
    '',
  ])
  return `${[cols.join(';'), ...rows.map((r) => r.join(';'))].join('\n')}\n`
}

// ─── Banco ───────────────────────────────────────────────────────────────────

export type BankSynthRow = {
  date: string
  description: string
  voucher?: string
  /** Con signo: + crédito, − débito. */
  amount: number
}

/** CUIT de fantasía para las transferencias del extracto. */
export const BANK_SENDER_CUIT = makeCuit('27', 23_456_789)
export const BANK_SUPPLIER_CUIT = makeCuit('30', 68_123_456)

/**
 * Una semana de un bar en Banco Nación (`banco.md` §2): transferencia recibida
 * con su 25.413, retiro de Mercado Pago, liquidación de tarjetas con SIRCREB,
 * pago a un proveedor, VEP, la comisión mensual con IVA 21 % y percepción 3 %,
 * depósito de efectivo, sueldos, débito automático, intereses con IVA 10,5 % y
 * un cheque acreditado.
 */
export function bankWeek(): BankSynthRow[] {
  return [
    {
      date: '2026-10-01',
      description: `CR.TRANF.INT.DIST ${BANK_SENDER_CUIT}`,
      voucher: '102345',
      amount: 15_000_000,
    },
    { date: '2026-10-01', description: 'IMP AL DEB/CRED', amount: -90_000 },
    {
      date: '2026-10-02',
      description: 'TRANSF MERCADOPAGO',
      voucher: '558812',
      amount: 10_000_000,
    },
    { date: '2026-10-02', description: 'LIQ+PAGOS NACIO', amount: 4_850_000 },
    { date: '2026-10-02', description: 'REG REC SIRCREB', amount: -145_500 },
    {
      date: '2026-10-03',
      description: `DEB.TRAN.INTERB-LINK ${BANK_SUPPLIER_CUIT}`,
      voucher: '77812',
      amount: -8_500_000,
    },
    { date: '2026-10-03', description: 'IMP AL DEB/CRED', amount: -51_000 },
    { date: '2026-10-03', description: 'PAGO VEP AFIP', amount: -12_500_000 },
    { date: '2026-10-06', description: 'COMISION PAQUETES', amount: -6_900_000 },
    { date: '2026-10-06', description: 'I.V.A. BASE', amount: -1_449_000 },
    { date: '2026-10-06', description: 'RETEN. I.V.A. RG.2408', amount: -207_000 },
    { date: '2026-10-06', description: 'CR-DEPEF', amount: 3_000_000 },
    { date: '2026-10-07', description: 'PAGO HABERES', amount: -25_000_000 },
    { date: '2026-10-07', description: 'DEBAUT SERVICIO LUZ', amount: -1_830_000 },
    { date: '2026-10-07', description: 'INTERESES S/SALDO DEUDOR', amount: -100_000 },
    { date: '2026-10-07', description: 'I.V.A. BASE', amount: -10_500 },
    { date: '2026-10-07', description: '48HS. CANJE ZONAL', voucher: '9', amount: 1_200_000 },
  ]
}

/** Saldo después de cada fila, desde un saldo inicial. */
export function bankBalances(rows: readonly BankSynthRow[], opening: number): number[] {
  let b = opening
  return rows.map((r) => {
    b += r.amount
    return b
  })
}

export const BANK_OPENING = 100_000_000

/** NE24 en CSV: metadatos, `;`, Windows-1252, CRLF, importe sin signo y columna D/C. */
export function bankDcCsv(): string {
  const rows = bankWeek()
  const balances = bankBalances(rows, BANK_OPENING)
  const lines = [
    'Banco de la Nación Argentina',
    'Consulta de movimientos históricos - Nación Empresa 24',
    `Cuenta Corriente en Pesos N° 1230012345 - CBU ${OWN_CBU}`,
    `Titular: BAR DE PRUEBA SAS - CUIT ${SAS_CUIT.slice(0, 2)}-${SAS_CUIT.slice(2, 10)}-${SAS_CUIT.slice(10)}`,
    'Período: 01/10/2026 al 07/10/2026',
    '',
    'Fecha;Fecha valor;Descripción;Comprobante;Importe;D/C;Saldo',
    `01/10/2026;01/10/2026;SALDO ANTERIOR;;;;${centsEsAr(BANK_OPENING)}`,
    ...rows.map((r, i) =>
      [
        dmy(r.date),
        dmy(r.date),
        r.description,
        r.voucher ?? '',
        centsEsAr(Math.abs(r.amount)),
        r.amount < 0 ? 'D' : 'C',
        centsEsAr(balances[i] ?? 0),
      ].join(';'),
    ),
  ]
  return `${lines.join('\r\n')}\r\n`
}

/** TXT con `|`, UTF-8, importe con signo, sin saldo, con estado (uno pendiente) y dos filas idénticas. */
export function bankSignedTxt(): string {
  const lines = [
    'Banco de la Nación Argentina - Nación Empresa 24',
    'Cuenta: 1230012345',
    'FECHA|CONCEPTO|REFERENCIA|IMPORTE|ESTADO',
    '08/10/2026|COMIS.TRANSF.NE24|1001|-956,00|Conformado',
    '08/10/2026|I.V.A. BASE|1001|-200,76|Conformado',
    '08/10/2026|IMP AL DEB/CRED||-6,00|Conformado',
    '08/10/2026|IMP AL DEB/CRED||-6,00|Conformado',
    `09/10/2026|TRANSFERENCIA RECIBIDA ${BANK_SENDER_CUIT}||250.000,00|Conformado`,
    '09/10/2026|PAGO CON TRANSF||12.300,00|Pendiente',
    '10/10/2026|TRANSF. A TERCEROS||-1.500.000,00|Conformado',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * CSV en «inglés» (`,` y punto decimal), importe SIN signo y saldo, del más
 * nuevo al más viejo, con saldo deudor negativo y la fila de saldo anterior al
 * final: el sentido sale de la diferencia de saldo.
 */
export function bankBalanceCsv(): string {
  const rows: BankSynthRow[] = [
    { date: '2026-10-12', description: 'CR INTERB', amount: 300_000 },
    { date: '2026-10-13', description: 'TRANSFERENCIA EMITIDA', amount: -900_000 },
    { date: '2026-10-13', description: 'COMIS.TRANSF.NE24', amount: -95_600 },
    { date: '2026-10-14', description: 'DEPOSITO EFECTIVO', amount: 250_000 },
  ]
  const opening = 200_000
  const balances = bankBalances(rows, opening)
  const lines = rows.map((r, i) =>
    [dmy(r.date), r.description, centsDot(Math.abs(r.amount)), centsDot(balances[i] ?? 0)].join(
      ',',
    ),
  )
  return `${[
    'Fecha,Descripcion,Monto,Saldo',
    ...lines.reverse(),
    `11/10/2026,SALDO ANTERIOR,,${centsDot(opening)}`,
  ].join('\n')}\n`
}

/** XLSX con columnas Débito y Crédito, fechas como celdas de fecha y metadatos arriba. */
export function bankXlsxRows(): XCell[][] {
  const rows = bankWeek().slice(0, 8)
  const balances = bankBalances(rows, BANK_OPENING)
  const s = (v: string): XCell => ({ t: 's', v })
  const n = (v: number, st?: number): XCell => (st ? { t: 'n', v, s: st } : { t: 'n', v })
  return [
    [s('Banco de la Nación Argentina')],
    [s(`CBU: ${OWN_CBU}`)],
    [s('Moneda: Pesos')],
    [],
    [s('Fecha'), s('Descripción'), s('Comprobante'), s('Débito'), s('Crédito'), s('Saldo')],
    ...rows.map((r, i): XCell[] => [
      n(excelSerial(r.date), 1),
      s(r.description),
      r.voucher ? s(r.voucher) : null,
      r.amount < 0 ? n(-r.amount / 100, 3) : null,
      r.amount > 0 ? n(r.amount / 100, 3) : null,
      n((balances[i] ?? 0) / 100, 3),
    ]),
  ]
}

/** El «.xls» que es una página HTML: una tabla de datos de la cuenta y otra de movimientos. */
export function bankHtml(): string {
  const rows = bankWeek().slice(8)
  const opening = bankBalances(bankWeek().slice(0, 8), BANK_OPENING).at(-1) ?? 0
  const balances = bankBalances(rows, opening)
  const tr = (cells: readonly string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
  return [
    '<html><head><meta charset="utf-8"><title>Movimientos</title><style>td{mso-number-format:"\\@"}</style></head><body>',
    '<table border="0">',
    `<tr><td colspan="2"><b>Banco de la Naci&oacute;n Argentina</b></td></tr>`,
    `<tr><td>CBU</td><td>${OWN_CBU}</td></tr>`,
    '</table>',
    '<table border="1">',
    '<tr><th>Fecha</th><th>Concepto</th><th>D&eacute;bitos</th><th>Cr&eacute;ditos</th><th>Saldo</th></tr>',
    ...rows.map((r, i) =>
      tr([
        dmy(r.date),
        r.description.replace(/&/g, '&amp;'),
        r.amount < 0 ? centsEsAr(-r.amount) : '&nbsp;',
        r.amount > 0 ? centsEsAr(r.amount) : '&nbsp;',
        centsEsAr(balances[i] ?? 0),
      ]),
    ),
    '</table></body></html>',
  ].join('\n')
}
