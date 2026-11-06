/**
 * Unidades, presentaciones y números de Compras. Puro: lo usan el cálculo, la cocina y el panel.
 */

const EPSILON = 1e-6

/** Las que ofrece el formulario. La base acepta cualquier texto corto (las planillas traen de todo). */
export const UNIT_OPTIONS = [
  'kg',
  'g',
  'L',
  'ml',
  'unidad',
  'atado',
  'paquete',
  'porción',
  'hoja',
  'bandeja',
  'botella',
  'lata',
  'frasco',
] as const

/** Las que se cuentan en pedazos enteros: no tiene sentido pedir 2,3 paquetes. */
const WHOLE_UNITS = new Set([
  'unidad',
  'u',
  'atado',
  'paquete',
  'porcion',
  'hoja',
  'bandeja',
  'botella',
  'lata',
  'frasco',
  'caja',
  'docena',
])

/** «Porción» y «porcion», «KG» y «kg», «Lt» y «L» son la misma unidad. */
export function unitKey(unit: string | null | undefined): string {
  const u = (unit ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (u === 'l' || u === 'lt' || u === 'lts' || u === 'litro' || u === 'litros') return 'l'
  if (u === 'u' || u === 'un' || u === 'unid' || u === 'unidades') return 'unidad'
  if (u === 'kilo' || u === 'kilos' || u === 'kgs') return 'kg'
  if (u === 'gr' || u === 'grs' || u === 'gramos') return 'g'
  if (u === 'cc') return 'ml'
  return u
}

export function sameUnit(a: string | null | undefined, b: string | null | undefined): boolean {
  return unitKey(a) === unitKey(b)
}

const PLURALS: Record<string, string> = {
  atado: 'atados',
  paquete: 'paquetes',
  porcion: 'porciones',
  hoja: 'hojas',
  bandeja: 'bandejas',
  botella: 'botellas',
  lata: 'latas',
  frasco: 'frascos',
  caja: 'cajas',
  docena: 'docenas',
}

/** Para mostrar al lado de un número: «unidad» → «u»; con más de uno, «botellas», «atados». */
export function unitShort(unit: string, qty?: number | null): string {
  const key = unitKey(unit)
  if (key === 'unidad') return 'u'
  if (qty != null && Math.abs(qty - 1) > EPSILON && PLURALS[key]) return PLURALS[key]
  return unit
}

/**
 * Pasa una cantidad de una unidad a otra cuando la cuenta es segura (kg ↔ g, L ↔ ml). Si son la misma,
 * devuelve la misma cantidad. Si no se puede (unidad contra kg), `null`: la receta y el insumo no hablan
 * de lo mismo y es un dato para corregir.
 */
export function convertQty(
  qty: number,
  from: string | null | undefined,
  to: string,
): number | null {
  const f = unitKey(from ?? to)
  const t = unitKey(to)
  if (f === t) return qty
  if (f === 'g' && t === 'kg') return qty / 1000
  if (f === 'kg' && t === 'g') return qty * 1000
  if (f === 'ml' && t === 'l') return qty / 1000
  if (f === 'l' && t === 'ml') return qty * 1000
  return null
}

export function isWholeUnit(unit: string): boolean {
  return WHOLE_UNITS.has(unitKey(unit))
}

/** Redondea hacia arriba sin que el ruido de los decimales sume una presentación (4,0000001 → 4). */
function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step - EPSILON) * step
}

/** Redondea a 3 decimales para que 0,1 + 0,2 no muestre 0,30000000000000004. */
export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Cuántas presentaciones hay que pedir para cubrir `need` (en la unidad del insumo), siempre hacia
 * arriba. Sin presentación cargada se pide en la unidad: enteros si es algo que se cuenta por pieza, y
 * de a 0,1 si se pesa o se mide.
 */
export function packsFor(need: number, packSize: number | null, unit: string): number {
  if (need <= EPSILON) return 0
  if (packSize && packSize > 0) return Math.max(1, ceilTo(need / packSize, 1))
  return roundQty(isWholeUnit(unit) ? ceilTo(need, 1) : ceilTo(need, 0.1))
}

/** Las presentaciones, de vuelta en la unidad del insumo (lo que está en camino). */
export function packsToUnits(packs: number, packSize: number | null): number {
  return roundQty(packs * (packSize && packSize > 0 ? packSize : 1))
}

/** `1,5` · `66` · `0,25`: hasta dos decimales, con coma. */
export function formatQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–'
  const rounded = Math.round(value * 100) / 100
  return rounded.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

/** Una cantidad con su unidad: «2,5 kg», «66 u». */
export function formatAmount(value: number | null | undefined, unit: string): string {
  return `${formatQty(value)} ${unitShort(unit, value)}`.trim()
}

/**
 * Cómo se lee lo que se pide: «66 kg» (por kilo), «3 × Caja x 150 u», «2 × 2 kg» (`x 2 kg`).
 * Es el mismo texto del WhatsApp, del panel y de la recepción.
 */
export function packsText(input: {
  packs: number | null | undefined
  packLabel: string | null
  packSize: number | null
  unit: string
}): string {
  const { packs, packLabel, packSize, unit } = input
  const label = (packLabel ?? '').trim()
  const size = packSize && packSize > 0 ? packSize : null
  // «Por kg», «Unidad» o sin presentación: lo que se pide ya está en la unidad del insumo.
  if ((size === null || size === 1) && (!label || /^(unidad|por\s)/i.test(label))) {
    return formatAmount(packs, unit)
  }
  if (!label) return `${formatQty(packs)} × ${formatAmount(size, unit)}`
  return `${formatQty(packs)} × ${label.replace(/^x\s+/i, '')}`
}

/**
 * Lee un número escrito a mano en la cocina: «2,5», «2.5», « 3 ». Vacío o inválido → `null`.
 * No acepta negativos.
 */
export function parseQty(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(',', '.')
  if (!t) return null
  if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? roundQty(n) : null
}
