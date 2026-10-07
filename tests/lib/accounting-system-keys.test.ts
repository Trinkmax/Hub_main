import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CODE_RE,
  type ChartAccountSeed,
  chartAccountByCode,
  chartAccountBySystemKey,
  chartLevel,
  chartParentCode,
  isContraAccount,
  naturalSide,
  STANDARD_CHART,
} from '@/lib/accounting/chart'
import {
  COMMISSION_KEYS,
  COMPENSABLE_KEYS,
  IVA_SETTLEMENT_KEYS,
  isSystemAccountKey,
  SALES_ACCOUNT_KEYS,
  SYSTEM_ACCOUNT_KEYS,
  SYSTEM_ACCOUNT_LABELS,
  salesAccountKey,
  TAX_PAYABLE_KEYS,
  VAT_ACCOUNT_KEYS,
} from '@/lib/accounting/system-keys'
import { CHANNELS } from '@/lib/accounting/types'
import { ADJUSTMENT_SPLIT_KEYS, commissionKeyFor } from '@/lib/accounting/validate'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const MIGRATIONS = join(ROOT, 'supabase/migrations')

describe('SYSTEM_ACCOUNT_KEYS contra el plan estándar', () => {
  const seededKeys = STANDARD_CHART.flatMap((a) => (a.systemKey ? [a.systemKey] : []))

  it('sin repetidas y exactamente las sembradas', () => {
    expect(new Set(SYSTEM_ACCOUNT_KEYS).size).toBe(SYSTEM_ACCOUNT_KEYS.length)
    expect(new Set(seededKeys).size).toBe(seededKeys.length)
    expect([...SYSTEM_ACCOUNT_KEYS].sort()).toEqual([...seededKeys].sort())
    expect(SYSTEM_ACCOUNT_KEYS).toHaveLength(88)
  })

  it('toda clave del sistema es una cuenta imputable de nivel 4', () => {
    for (const key of SYSTEM_ACCOUNT_KEYS) {
      const account = chartAccountBySystemKey(key)
      expect(account, key).toBeDefined()
      expect(account?.postable, key).toBe(true)
      expect(chartLevel(account?.code ?? ''), key).toBe(4)
      expect(key).toMatch(/^[a-z][a-z0-9_]{2,40}$/)
    }
  })

  it('etiquetas: el nombre de su cuenta', () => {
    expect(SYSTEM_ACCOUNT_LABELS.vat_credit).toBe('IVA crédito fiscal')
    expect(SYSTEM_ACCOUNT_LABELS.opening_equity).toBe('Saldo de apertura a asignar')
    for (const key of SYSTEM_ACCOUNT_KEYS) expect(SYSTEM_ACCOUNT_LABELS[key]).not.toBe(key)
  })

  it('las claves que usa el motor existen y son imputables (grupos de la matriz C.3.4)', () => {
    const used = [
      ...COMPENSABLE_KEYS,
      ...TAX_PAYABLE_KEYS,
      ...VAT_ACCOUNT_KEYS,
      ...IVA_SETTLEMENT_KEYS,
      ...COMMISSION_KEYS,
      ...SALES_ACCOUNT_KEYS,
      ...Object.values(ADJUSTMENT_SPLIT_KEYS).flat(),
      ...CHANNELS.flatMap((c) => [salesAccountKey(c, true), salesAccountKey(c, false)]),
      commissionKeyFor('card_processor'),
      commissionKeyFor('payment_wallet'),
      commissionKeyFor('delivery_platform'),
      commissionKeyFor('supplier'),
    ]
    for (const key of used) {
      expect(isSystemAccountKey(key), key).toBe(true)
      expect(chartAccountBySystemKey(key)?.postable, key).toBe(true)
    }
  })

  it('las deudas fiscales de una DDJJ llevan partícipe; los saldos compensables no', () => {
    for (const key of TAX_PAYABLE_KEYS)
      expect(chartAccountBySystemKey(key)?.requiresParty, key).toBe(true)
    for (const key of COMPENSABLE_KEYS)
      expect(chartAccountBySystemKey(key)?.requiresParty, key).toBe(false)
  })

  it('isSystemAccountKey', () => {
    expect(isSystemAccountKey('vat_credit')).toBe(true)
    expect(isSystemAccountKey('vat_credito')).toBe(false)
    expect(isSystemAccountKey(null)).toBe(false)
  })
})

describe('forma del plan estándar (§D)', () => {
  it('164 cuentas: 48 grupos y 116 imputables', () => {
    expect(STANDARD_CHART).toHaveLength(164)
    expect(STANDARD_CHART.filter((a) => !a.postable)).toHaveLength(48)
    expect(STANDARD_CHART.filter((a) => a.postable)).toHaveLength(116)
  })

  it('códigos únicos, con formato, y cada madre antes que sus hijas', () => {
    const seen = new Set<string>()
    for (const a of STANDARD_CHART) {
      expect(a.code).toMatch(ACCOUNT_CODE_RE)
      expect(a.code.length).toBeLessThanOrEqual(24)
      expect(seen.has(a.code), a.code).toBe(false)
      const parent = chartParentCode(a.code)
      if (parent !== null) {
        expect(seen.has(parent), `${a.code} sin madre ${parent}`).toBe(true)
        const mother = chartAccountByCode(parent)
        expect(mother?.postable, `${parent} tiene que ser grupo`).toBe(false)
        expect(mother?.type, `${a.code} hereda el tipo`).toBe(a.type)
      }
      seen.add(a.code)
    }
  })

  it('imputables las de nivel 4; las raíces son grupos', () => {
    for (const a of STANDARD_CHART) expect(a.postable, a.code).toBe(chartLevel(a.code) === 4)
  })

  it('lado normal: el de su tipo salvo las regularizadoras', () => {
    const contras = STANDARD_CHART.filter(isContraAccount).map((a) => a.code)
    expect(contras).toEqual(['1.1.02.09', '1.2.01.09', '1.2.02.09', '3.1.01.02'])
    for (const a of STANDARD_CHART.filter((x) => !x.postable)) {
      expect(a.normalSide, a.code).toBe(naturalSide(a.type))
    }
  })

  it('cuentas de control y «¿En qué?» coherentes con la matriz', () => {
    for (const a of STANDARD_CHART) {
      if (a.requiresParty) expect(a.postable, a.code).toBe(true)
      if (a.purchaseSelectable) {
        // Toda cuenta de «¿En qué?» tiene que servir como imputación de compra (C.3.4).
        expect(
          a.postable && !a.requiresParty && (a.type === 'expense' || a.type === 'asset'),
          a.code,
        ).toBe(true)
      }
    }
  })

  it('nombres y «Para qué se usa» dentro de los CHECK', () => {
    for (const a of STANDARD_CHART) {
      expect(a.name.trim().length, a.code).toBeGreaterThanOrEqual(2)
      expect(a.name.length, a.code).toBeLessThanOrEqual(80)
      if (a.description !== null) expect(a.description.length, a.code).toBeLessThanOrEqual(280)
    }
  })

  it('las cinco raíces de §D', () => {
    expect(
      STANDARD_CHART.filter((a) => chartLevel(a.code) === 1).map((a) => [a.code, a.type]),
    ).toEqual([
      ['1', 'asset'],
      ['2', 'liability'],
      ['3', 'equity'],
      ['4', 'income'],
      ['5', 'expense'],
    ])
  })
})

// ─── Paridad con la migración del seed (§I.4) ────────────────────────────────

function findSeedMigration(): string | null {
  if (!existsSync(MIGRATIONS)) return null
  const name = readdirSync(MIGRATIONS).find((f) => /_acc_seed_functions\.sql$/.test(f))
  return name ? join(MIGRATIONS, name) : null
}

/** Los valores de una tupla SQL `('a', 'b, c', true, null, 'it''s')` → tokens (texto o literal crudo). */
function sqlTuple(text: string): Array<string | null | boolean> {
  const body = text.trim().replace(/^\(/, '').replace(/\),?$/, '')
  const out: Array<string | null | boolean> = []
  let i = 0
  while (i < body.length) {
    while (body[i] === ' ' || body[i] === ',') i++
    if (i >= body.length) break
    if (body[i] === "'") {
      let value = ''
      i++
      while (i < body.length) {
        if (body[i] === "'" && body[i + 1] === "'") {
          value += "'"
          i += 2
        } else if (body[i] === "'") {
          i++
          break
        } else {
          value += body[i]
          i++
        }
      }
      out.push(value)
    } else {
      let raw = ''
      while (i < body.length && body[i] !== ',') raw += body[i++]
      const t = raw.trim()
      out.push(t === 'null' ? null : t === 'true' ? true : t === 'false' ? false : t)
    }
  }
  return out
}

function parseSeedChart(sql: string): ChartAccountSeed[] {
  const begin = sql.indexOf('@acc-seed-chart:begin')
  const end = sql.indexOf('@acc-seed-chart:end')
  if (begin === -1 || end === -1)
    throw new Error('No están los marcadores @acc-seed-chart en la migración')
  return sql
    .slice(begin, end)
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('('))
    .map((l) => {
      const [
        code,
        name,
        type,
        normalSide,
        postable,
        systemKey,
        requiresParty,
        purchaseSelectable,
        description,
      ] = sqlTuple(l)
      return {
        code: String(code),
        name: String(name),
        type: type as ChartAccountSeed['type'],
        normalSide: normalSide as ChartAccountSeed['normalSide'],
        postable: postable === true,
        systemKey: (systemKey ?? null) as ChartAccountSeed['systemKey'],
        requiresParty: requiresParty === true,
        purchaseSelectable: purchaseSelectable === true,
        description: (description ?? null) as string | null,
      }
    })
}

describe('paridad con private.acc_seed_chart (migración #7)', () => {
  const file = findSeedMigration()

  it('el parser de tuplas SQL respeta comas y comillas dentro de los textos', () => {
    expect(
      sqlTuple(
        "('5.3.02.11', 'Música y derechos (SADAIC, AADI-CAPIF)', 'expense', 'debit', true, null, false, true, 'It''s')",
      ),
    ).toEqual([
      '5.3.02.11',
      'Música y derechos (SADAIC, AADI-CAPIF)',
      'expense',
      'debit',
      true,
      null,
      false,
      true,
      "It's",
    ])
  })

  it.skipIf(file === null)('el seed SQL y STANDARD_CHART dicen exactamente lo mismo', () => {
    const seeded = parseSeedChart(readFileSync(file ?? '', 'utf8'))
    expect(seeded).toHaveLength(STANDARD_CHART.length)
    const byCode = new Map(seeded.map((a) => [a.code, a]))
    for (const a of STANDARD_CHART) expect(byCode.get(a.code), a.code).toEqual(a)
  })

  it.skipIf(file === null)(
    'SYSTEM_ACCOUNT_KEYS (TS) = las system_key que siembra la migración',
    () => {
      const seeded = parseSeedChart(readFileSync(file ?? '', 'utf8'))
      const keys = seeded.flatMap((a) => (a.systemKey ? [a.systemKey] : []))
      expect([...keys].sort()).toEqual([...SYSTEM_ACCOUNT_KEYS].sort())
    },
  )
})
