/**
 * Reglas para clasificar los movimientos del banco (diseño §4.3.3, `banco.md`
 * §2.10 y §3.9).
 *
 * - `DEFAULT_BANK_RULES`: las 21 de la tabla maestra, en orden; gana la primera.
 *   Se aplican sobre la descripción normalizada (mayúsculas, sin tildes, espacios
 *   colapsados) y el SENTIDO lo da el importe (+ crédito, − débito), nunca el
 *   texto. Son un punto de partida: se calibran con los extractos reales de la
 *   SAS (las 53 descripciones de `banco-scripts/check-rules.mjs` están en los
 *   tests).
 * - Las reglas del bar (`acc_import_rules`, `source = 'bank_statement'`) van
 *   ANTES que las de fábrica, por prioridad: sentido, expresión regular, CUIT de
 *   la contraparte, rango de importe y caja → una acción que arma la propuesta.
 *
 * «Una imputación confiada pero equivocada es peor que un casillero vacío»
 * (xExtracta): lo que no calza queda «a identificar».
 */

import type { BankItem, Cents } from '../types'
import { normalizeBankDescription } from './statement'

export type BankCategory =
  | 'ley25413'
  | 'sircreb'
  | 'perc_iva'
  | 'iva_cf'
  | 'intereses'
  | 'comisiones'
  | 'cheques'
  | 'tarjetas'
  | 'pct'
  | 'propias_mp'
  | 'tarjeta_corp'
  | 'arca'
  | 'prov_munic'
  | 'sueldos'
  | 'deb_aut'
  | 'efectivo_in'
  | 'efectivo_out'
  | 'transf_in'
  | 'transf_out'
  | 'reverso'
  | 'a_identificar'

/** D = débito (sale), C = crédito (entra), * = cualquiera. */
export type RuleDirection = 'D' | 'C' | '*'
export type RuleConfidence = 'alta' | 'media' | 'baja'

export type DefaultBankRule = {
  /** 1 a 21, el orden de la tabla maestra. */
  readonly id: number
  readonly category: BankCategory
  readonly direction: RuleDirection
  readonly pattern: RegExp | null
  /** CUIT de contrapartes que también la disparan (además de la expresión). */
  readonly counterpartyCuits?: readonly string[]
  /** La dispara también una transferencia de o hacia la propia CUIT. */
  readonly ownCuit?: boolean
  /** El «motivo» que ve la persona. */
  readonly label: string
  readonly confidence: RuleConfidence
}

/** MercadoLibre S.R.L. (retiros de Mercado Pago, `banco.md` §2.8). */
export const MERCADOLIBRE_CUIT = '30703088534'
/** ARCA/AFIP (VEP, `banco.md` §2.9). */
export const ARCA_CUIT = '33693450239'

/** La tabla maestra de `banco.md` §2.10, tal cual se probó con `check-rules.mjs`. */
export const DEFAULT_BANK_RULES: readonly DefaultBankRule[] = [
  {
    id: 1,
    category: 'ley25413',
    direction: 'D',
    pattern:
      /LEY\s*25\.?413|IMP(UESTO)?\.?\s*(AL\s*)?(DEB|CRED)|GRAV(AMEN)?\.?\s*LEY|I25413|IMP\.?\s*DEB\.?\s*TASA|DB\/CR\s*BANCARIOS/i,
    label: 'Impuesto a los débitos y créditos (Ley 25.413)',
    confidence: 'alta',
  },
  {
    id: 2,
    category: 'sircreb',
    direction: 'D',
    pattern:
      /SIRCREB|DBSIR\d*|REG\.?\s*REC|RECAUD.*(IIBB|ING\.?\s*BR)|RET(EN)?\.?\s*(IIBB|I\.?B\.?|ING\.?\s*BR)|GRAV\.?\s*IB/i,
    label: 'Recaudación de Ingresos Brutos (SIRCREB)',
    confidence: 'alta',
  },
  {
    id: 3,
    category: 'perc_iva',
    direction: 'D',
    pattern: /RG\.?\s*2408|PERC(EP)?\.?\s*(DE\s*)?I\.?\s*V\.?\s*A|RETEN\.?\s*I\.?\s*V\.?\s*A/i,
    label: 'Percepción de IVA (RG 2408)',
    confidence: 'alta',
  },
  {
    id: 4,
    category: 'iva_cf',
    direction: 'D',
    pattern: /\bI\.?\s*V\.?\s*A\.?\b/i,
    label: 'IVA de comisiones o intereses',
    confidence: 'alta',
  },
  {
    id: 5,
    category: 'intereses',
    direction: 'D',
    pattern: /INT(ERES(ES)?)?\.?\s*(S\/\s*)?(SALDO\s*)?(DEUDOR|DESCUB|NEG)/i,
    label: 'Intereses por saldo deudor',
    confidence: 'media',
  },
  {
    id: 6,
    category: 'comisiones',
    direction: 'D',
    pattern: /COMIS|COMI\s|MANT(ENIMIENTO)?|PAQUETE|ARANCEL|CARGO\s/i,
    label: 'Comisiones bancarias',
    confidence: 'alta',
  },
  {
    id: 7,
    category: 'cheques',
    direction: '*',
    pattern: /^(48|24)\s*HS\.?\s*(BANCOS|CANJE)/i,
    label: 'Cheque (48 h): propio pagado o de terceros acreditado',
    confidence: 'alta',
  },
  {
    id: 8,
    category: 'tarjetas',
    direction: 'C',
    pattern:
      /(LIQ|ACRED|CR\.?|CRED\.?).*(VISA|MASTER|CABAL|MAESTRO|AMEX|NARANJA|PRISMA|PAYWAY|FISERV|FIRST\s*DATA|POSNET|\+?\s*PAGOS\s*NACI)/i,
    label: 'Liquidación de tarjetas o QR',
    confidence: 'media',
  },
  {
    id: 9,
    category: 'pct',
    direction: 'C',
    pattern: /(PAGO|COMPRA)\s*(CON\s*TRANSF|CT\b)/i,
    label: 'Cobro con transferencia (QR)',
    confidence: 'media',
  },
  {
    id: 10,
    category: 'propias_mp',
    direction: '*',
    pattern: /MERCADO\s*(PAGO|LIBRE)|MERCADOLIBRE/i,
    counterpartyCuits: [MERCADOLIBRE_CUIT],
    ownCuit: true,
    label: 'Transferencia entre cuentas propias (Mercado Pago)',
    confidence: 'media',
  },
  {
    id: 11,
    category: 'tarjeta_corp',
    direction: 'D',
    pattern: /PM\/TOT\s*RESUMEN|DEB\.?\s*LIQ\s*VISA|DEB\/MAD|PAGO\s*TARJ/i,
    label: 'Pago de la tarjeta corporativa',
    confidence: 'alta',
  },
  {
    id: 12,
    category: 'arca',
    direction: 'D',
    pattern: /AFIP|ARCA|\bVEP\b|F\.?\s*931/i,
    counterpartyCuits: [ARCA_CUIT],
    label: 'Pago a ARCA (VEP)',
    confidence: 'alta',
  },
  {
    id: 13,
    category: 'prov_munic',
    direction: 'D',
    pattern: /RENTAS|DGR|ING(R)?\.?\s*BRUTOS|SELL|MUNIC/i,
    label: 'Impuestos provinciales o municipales',
    confidence: 'media',
  },
  {
    id: 14,
    category: 'sueldos',
    direction: 'D',
    pattern: /HABERES|SUELDO|ACRED\.?\s*HAB|PAGO\s*HAB/i,
    label: 'Sueldos',
    confidence: 'media',
  },
  {
    id: 15,
    category: 'deb_aut',
    direction: 'D',
    pattern: /DEB\.?\s*AUT|DEBAUT|DEBCAMA|PAGSERVDB|^DA\s|SEGURO/i,
    label: 'Débito automático o seguro',
    confidence: 'media',
  },
  {
    id: 16,
    category: 'efectivo_in',
    direction: 'C',
    pattern: /DEP(OSITO)?\.?\s*(EN\s*)?EF|CR-DEPEF/i,
    label: 'Depósito de efectivo',
    confidence: 'alta',
  },
  {
    id: 17,
    category: 'efectivo_out',
    direction: 'D',
    pattern: /EXTRAC|EXT(CAJ|RCAJA)/i,
    label: 'Extracción de efectivo',
    confidence: 'alta',
  },
  {
    id: 18,
    category: 'transf_in',
    direction: 'C',
    pattern:
      /CR\.?\s*TR|CRED\.?\s*TR|TRANS?F?\.?\s*INT|CR\s*INTERB|CREDIN|COELSA|DEBIN|TRANSF|TRANF|\bTRF\b/i,
    label: 'Transferencia recibida',
    confidence: 'media',
  },
  {
    id: 19,
    category: 'transf_out',
    direction: 'D',
    pattern:
      /DB\.?\s*TR|DEB\.?\s*TRAN|DB\s*CREDIN|DBHOMEBA|TRLINKEX|PAGO\s*PROV|DEBIN|TRANSF|TRANF|\bTRF\b/i,
    label: 'Transferencia enviada',
    confidence: 'media',
  },
  {
    id: 20,
    category: 'reverso',
    direction: '*',
    pattern: /DEV|REVERS|ANUL|CONTRASIENT|AJ\.?\s*LK|AJUSTE/i,
    label: 'Reverso o ajuste',
    confidence: 'baja',
  },
  {
    id: 21,
    category: 'a_identificar',
    direction: '*',
    pattern: null,
    label: 'A identificar',
    confidence: 'baja',
  },
]

// ─── Reglas del bar ──────────────────────────────────────────────────────────

/** Una regla de `acc_import_rules` ya compilada. La acción la interpreta la propuesta (WP6). */
export type CustomBankRule = {
  readonly id: string
  readonly priority: number
  readonly label: string
  readonly direction: RuleDirection
  readonly pattern: RegExp | null
  readonly counterpartyCuit: string | null
  /** Contra el importe sin signo. */
  readonly amountMin: Cents | null
  readonly amountMax: Cents | null
  readonly treasuryAccountId: string | null
  readonly action: Readonly<Record<string, unknown>>
}

/** Una fila de `acc_import_rules` (lo que hace falta para compilarla). */
export type ImportRuleRow = {
  readonly id: string
  readonly priority: number
  readonly label: string
  readonly match: unknown
  readonly action: unknown
}

function cents(v: unknown): Cents | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null
}

/**
 * Compila una regla guardada. La expresión se arma sin distinguir mayúsculas y se
 * aplica a la descripción normalizada. `null` si la regla no sirve (expresión
 * inválida o sin ningún criterio): nunca tira.
 */
export function compileBankRule(row: ImportRuleRow): CustomBankRule | null {
  if (typeof row.match !== 'object' || row.match === null) return null
  const m = row.match as Record<string, unknown>
  const dir = m.direction
  const direction: RuleDirection =
    dir === 'D' || dir === 'debit' ? 'D' : dir === 'C' || dir === 'credit' ? 'C' : '*'
  let pattern: RegExp | null = null
  if (typeof m.pattern === 'string' && m.pattern.trim() !== '') {
    if (m.pattern.length > 200) return null
    try {
      pattern = new RegExp(m.pattern, 'i')
    } catch {
      return null
    }
  }
  const cuit = typeof m.counterparty_cuit === 'string' ? m.counterparty_cuit.replace(/\D/g, '') : ''
  const rule: CustomBankRule = {
    id: row.id,
    priority: row.priority,
    label: row.label,
    direction,
    pattern,
    counterpartyCuit: cuit.length === 11 ? cuit : null,
    amountMin: cents(m.amount_min),
    amountMax: cents(m.amount_max),
    treasuryAccountId: typeof m.treasury_account_id === 'string' ? m.treasury_account_id : null,
    action:
      typeof row.action === 'object' && row.action !== null
        ? (row.action as Record<string, unknown>)
        : {},
  }
  if (
    !rule.pattern &&
    !rule.counterpartyCuit &&
    rule.amountMin === null &&
    rule.amountMax === null
  ) {
    return null
  }
  return rule
}

// ─── Clasificar ──────────────────────────────────────────────────────────────

export type BankClassification = {
  /** `default:<n>` para las de fábrica; el id de la regla del bar si no. */
  readonly ruleId: string
  /** La categoría de la tabla maestra; `null` si la definió una regla del bar. */
  readonly category: BankCategory | null
  readonly label: string
  readonly confidence: RuleConfidence
  readonly custom: boolean
  /** La acción de la regla del bar (o `null`). */
  readonly action: Readonly<Record<string, unknown>> | null
}

export type ClassifyOptions = {
  /** Reglas del bar (de `compileBankRule`): se prueban primero, por prioridad. */
  readonly custom?: readonly CustomBankRule[]
  /** CUIT de la SAS: una transferencia de o hacia ella es entre cuentas propias. */
  readonly ownCuit?: string | null
  /** La caja del extracto, para las reglas del bar que se limitan a una. */
  readonly treasuryAccountId?: string | null
  /** Para probar otra tabla; por defecto `DEFAULT_BANK_RULES`. */
  readonly rules?: readonly DefaultBankRule[]
}

/** El sentido de un importe: + crédito (C), − débito (D). */
export function bankDirectionOf(amount: Cents): 'D' | 'C' {
  return amount < 0 ? 'D' : 'C'
}

function defaultMatches(
  rule: DefaultBankRule,
  description: string,
  direction: 'D' | 'C',
  counterparty: string | null,
  ownCuit: string | null,
): boolean {
  if (rule.direction !== '*' && rule.direction !== direction) return false
  if (rule.pattern === null) return true
  if (rule.pattern.test(description)) return true
  if (counterparty !== null) {
    if (rule.counterpartyCuits?.includes(counterparty)) return true
    if (rule.ownCuit && ownCuit !== null && counterparty === ownCuit) return true
  }
  return false
}

/** La categoría de fábrica de una descripción con su sentido (lo que hace `check-rules.mjs`). */
export function classifyDescription(
  description: string,
  direction: 'D' | 'C',
  rules: readonly DefaultBankRule[] = DEFAULT_BANK_RULES,
): DefaultBankRule {
  const normalized = normalizeBankDescription(description)
  const found = rules.find((r) => defaultMatches(r, normalized, direction, null, null))
  return found ?? (DEFAULT_BANK_RULES[DEFAULT_BANK_RULES.length - 1] as DefaultBankRule)
}

/** Clasifica un movimiento: primero las reglas del bar, después la tabla maestra. */
export function classifyBankItem(
  item: Pick<BankItem, 'description' | 'amount' | 'counterpartyCuit'>,
  opts: ClassifyOptions = {},
): BankClassification {
  const description = normalizeBankDescription(item.description)
  const direction = bankDirectionOf(item.amount)
  const abs = Math.abs(item.amount)
  const counterparty = item.counterpartyCuit
  const own = opts.ownCuit ? opts.ownCuit.replace(/\D/g, '') : null

  const custom = [...(opts.custom ?? [])].sort((a, b) => a.priority - b.priority)
  for (const r of custom) {
    if (r.direction !== '*' && r.direction !== direction) continue
    if (
      r.treasuryAccountId &&
      opts.treasuryAccountId &&
      r.treasuryAccountId !== opts.treasuryAccountId
    ) {
      continue
    }
    if (r.pattern && !r.pattern.test(description)) continue
    if (r.counterpartyCuit && r.counterpartyCuit !== counterparty) continue
    if (r.amountMin !== null && abs < r.amountMin) continue
    if (r.amountMax !== null && abs > r.amountMax) continue
    return {
      ruleId: r.id,
      category: null,
      label: r.label,
      confidence: 'alta',
      custom: true,
      action: r.action,
    }
  }

  const rules = opts.rules ?? DEFAULT_BANK_RULES
  const found =
    rules.find((r) => defaultMatches(r, description, direction, counterparty, own)) ??
    (DEFAULT_BANK_RULES[DEFAULT_BANK_RULES.length - 1] as DefaultBankRule)
  return {
    ruleId: `default:${found.id}`,
    category: found.category,
    label: found.label,
    confidence: found.confidence,
    custom: false,
    action: null,
  }
}

/**
 * La descripción sin números ni CUIT, para proponer «Crear regla» cuando la
 * persona reclasifica una fila (`banco.md` §3.9): `TRANSF. A 30-71234567-1 FAC 123`
 * → `TRANSF\..*A.*FAC`.
 */
export function suggestRulePattern(description: string): string {
  const words = normalizeBankDescription(description)
    .replace(/\d[\d./-]*/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '')
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return escaped.join('.*').slice(0, 200)
}
