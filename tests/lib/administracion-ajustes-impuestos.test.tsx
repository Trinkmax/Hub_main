// @vitest-environment node
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/hub/administracion/ajustes',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/accounting/access', () => ({ authorizeAccounting: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { TaxesPanel } from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_components/taxes-panel'
import {
  isTaxBase,
  municipalNote,
  percentCellText,
  readPercentCell,
  TAX_BASE_LABELS,
  TAX_ROWS,
} from '@/app/(manager)/[tenantSlug]/administracion/ajustes/_lib/taxes-view'
import { authorizeAccounting } from '@/lib/accounting/access'
import { saveTaxSettings, setTreasuryBankTax } from '@/lib/accounting/actions/taxes'
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from '@/lib/accounting/taxes'
import { createClient } from '@/lib/supabase/server'

/**
 * Ajustes › Impuestos: los porcentajes con los que se calculan solos Ingresos Brutos, Comercio e
 * Industria y el impuesto al cheque. Se cuida qué se puede escribir y quién, cómo se lee lo escrito y
 * qué le llega a la base.
 */

const SLUG = 'hub'
const TENANT = '00000000-0000-4000-8000-0000000000aa'
const TREASURY = '11111111-1111-4111-8111-111111111111'

const html = (node: ReactElement) => renderToString(node).replaceAll('<!-- -->', '')
const panel = (readOnly: boolean, settings: TaxSettings = DEFAULT_TAX_SETTINGS) =>
  html(createElement(TaxesPanel, { tenantSlug: SLUG, settings, readOnly }))

describe('lo que se escribe en una celda', () => {
  it('se muestra como se escribe: sin el «%», que queda afuera', () => {
    expect(percentCellText(300)).toBe('3')
    expect(percentCellText(70)).toBe('0,7')
    expect(percentCellText(60)).toBe('0,6')
    expect(percentCellText(125)).toBe('1,25')
    expect(percentCellText(0)).toBe('0')
  })

  it('igual a lo guardado no se guarda de nuevo', () => {
    expect(readPercentCell('0,7', 70)).toEqual({ kind: 'same' })
    expect(readPercentCell('0.7', 70)).toEqual({ kind: 'same' })
    expect(readPercentCell('0,7 %', 70)).toEqual({ kind: 'same' })
  })

  it('lo distinto se guarda en centésimas de punto', () => {
    expect(readPercentCell('3,5', 300)).toEqual({ kind: 'changed', bp: 350 })
    expect(readPercentCell('0', 70)).toEqual({ kind: 'changed', bp: 0 })
    expect(readPercentCell('100', 70)).toEqual({ kind: 'changed', bp: 10_000 })
  })

  it('lo que no es un porcentaje dice cómo escribirlo', () => {
    for (const text of ['', 'tres', '101', '-1']) {
      const read = readPercentCell(text, 70)
      expect(read.kind, text).toBe('invalid')
      expect(read.kind === 'invalid' && read.message).toContain('de 0 a 100')
    }
  })

  it('«sobre qué» es uno de los dos', () => {
    expect(isTaxBase('invoiced_net')).toBe(true)
    expect(isTaxBase('all_sales')).toBe(true)
    expect(isTaxBase('otra')).toBe(false)
    expect(isTaxBase(null)).toBe(false)
  })
})

describe('la tabla', () => {
  it('los cuatro impuestos, con cuándo se calcula cada uno', () => {
    expect(TAX_ROWS.map((row) => [row.name, row.when])).toEqual([
      ['IVA', 'En cada comprobante'],
      ['Ingresos Brutos', 'En cada cierre'],
      ['Comercio e Industria', 'En cada cierre'],
      ['Débitos y créditos', 'Al pagar'],
    ])
  })

  it('el IVA es solo informativo: no se escribe y dice por qué', () => {
    const out = panel(false)
    expect(out).toContain('21')
    expect(out).toContain('Solo informativo: la alícuota va por comprobante.')
    expect(out).not.toContain('aria-label="Porcentaje de IVA"')
  })

  it('quien carga: tres celdas con su porcentaje, sin el «%» adentro', () => {
    const out = panel(false)
    expect(out).toMatch(/aria-label="Porcentaje de Ingresos Brutos"[^>]*value="3"/)
    expect(out).toMatch(/aria-label="Porcentaje de Comercio e Industria"[^>]*value="0,7"/)
    expect(out).toMatch(/aria-label="Porcentaje de Débitos y créditos"[^>]*value="0,6"/)
    expect(out.match(/aria-label="Porcentaje de /g)).toHaveLength(3)
  })

  it('«sobre qué» es un select para Ingresos Brutos y Comercio; es un solo dato', () => {
    const out = panel(false)
    expect(out).toContain('aria-label="Sobre qué se calcula Ingresos Brutos"')
    expect(out).toContain('aria-label="Sobre qué se calcula Comercio e Industria"')
    expect(out.match(/Lo facturado, sin IVA/g)).toHaveLength(2)
    const all = panel(false, { ...DEFAULT_TAX_SETTINGS, base: 'all_sales' })
    expect(all.match(/Todo lo vendido/g)).toHaveLength(2)
    // Los débitos y créditos tienen la suya, fija.
    expect(out).toContain('Cada pago con banco o billetera')
  })

  it('«Calcular solos» es un interruptor; apagado, se dice en cada uno', () => {
    const on = panel(false)
    expect(on).toContain('Calcular solos')
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"/)
    const off = panel(false, { ...DEFAULT_TAX_SETTINGS, auto: false })
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/)
    expect(off.match(/Apagado/g)).toHaveLength(3)
    // El IVA no depende de esto.
    expect(off).toContain('En cada comprobante')
  })

  it('la línea de Comercio e Industria', () => {
    const line = 'Comercio e Industria se dijo “0,007” y “0,007 %” en la reunión: quedó 0,7 %.'
    expect(panel(false)).toContain(`${line} Confirmalo con tu contadora.`)
    expect(municipalNote({ municipalBp: 70 }, { readOnly: false })).toBe(
      `${line} Confirmalo con tu contadora.`,
    )
    // Si alguien lo cambió, ya no hay nada que confirmar.
    expect(municipalNote({ municipalBp: 7 }, { readOnly: false })).toBeNull()
    expect(panel(false, { ...DEFAULT_TAX_SETTINGS, municipalBp: 7 })).not.toContain('se dijo')
  })

  it('la contadora ve lo mismo sin ningún control, y la línea le habla a ella', () => {
    const out = panel(true)
    expect(out).toContain('3 %')
    expect(out).toContain('0,7 %')
    expect(out).toContain('0,6 %')
    expect(out).toContain(TAX_BASE_LABELS.invoiced_net)
    expect(out).toContain('Se calculan solos')
    expect(out).toContain('Si es otro, avisales a los socios.')
    expect(out).not.toContain('Confirmalo con tu contadora')
    expect(out).not.toContain('<input')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('role="switch"')
    expect(out).not.toContain('role="combobox"')
    expect(panel(true, { ...DEFAULT_TAX_SETTINGS, auto: false })).toContain('No se calculan solos')
  })
})

describe('lo que le llega a la base', () => {
  type RpcResult = { data: unknown; error: unknown }
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>()

  function allow() {
    vi.mocked(authorizeAccounting).mockResolvedValue({
      ok: true,
      tenantId: TENANT,
      userId: '00000000-0000-4000-8000-0000000000cc',
      slug: SLUG,
      access: {} as never,
    })
  }

  beforeEach(() => {
    rpc.mockReset()
    vi.mocked(revalidatePath).mockClear()
    vi.mocked(authorizeAccounting).mockReset()
    vi.mocked(createClient).mockResolvedValue({ rpc } as never)
  })

  describe('saveTaxSettings', () => {
    const SETTINGS: TaxSettings = {
      auto: true,
      iibbBp: 350,
      municipalBp: 70,
      bankTaxBp: 60,
      base: 'all_sales',
    }

    it('pide poder cargar: sin eso no llama a la base', async () => {
      vi.mocked(authorizeAccounting).mockResolvedValue({
        ok: false,
        state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
      })
      const result = await saveTaxSettings(SLUG, SETTINGS)
      expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
      expect(result).toMatchObject({ ok: false, code: 'forbidden' })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('manda lo de `taxSettingsPayload`, revalida y devuelve lo guardado', async () => {
      allow()
      rpc.mockResolvedValue({
        data: {
          auto: true,
          iibb_bp: 350,
          municipal_bp: 70,
          bank_tax_bp: 60,
          base: 'all_sales',
        },
        error: null,
      })
      const result = await saveTaxSettings(SLUG, SETTINGS)
      expect(rpc).toHaveBeenCalledWith('acc_save_tax_settings', {
        p_tenant_id: TENANT,
        p_settings: {
          auto: true,
          iibb_bp: 350,
          municipal_bp: 70,
          bank_tax_bp: 60,
          base: 'all_sales',
        },
      })
      expect(result).toEqual({ ok: true, data: SETTINGS, message: 'Impuestos guardados.' })
      expect(revalidatePath).toHaveBeenCalledWith(`/${SLUG}/administracion`, 'layout')
    })

    it('lo que no es válido no llega a la base', async () => {
      allow()
      const cases: unknown[] = [
        { ...SETTINGS, iibbBp: 10_001 },
        { ...SETTINGS, municipalBp: -1 },
        { ...SETTINGS, bankTaxBp: 1.5 },
        { ...SETTINGS, base: 'otra' },
        { ...SETTINGS, auto: 'sí' },
        { auto: true },
        null,
      ]
      for (const raw of cases) {
        const result = await saveTaxSettings(SLUG, raw)
        expect(result.ok, JSON.stringify(raw)).toBe(false)
        expect(!result.ok && result.code).toBe('invalid')
      }
      expect(rpc).not.toHaveBeenCalled()
    })

    it('un error de la base llega con su texto, sin revalidar', async () => {
      allow()
      rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'forbidden' } })
      const result = await saveTaxSettings(SLUG, SETTINGS)
      expect(result.ok).toBe(false)
      expect(revalidatePath).not.toHaveBeenCalled()
    })

    it('si algo explota, no tira', async () => {
      allow()
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      rpc.mockRejectedValue(new Error('se cortó'))
      const result = await saveTaxSettings(SLUG, SETTINGS)
      expect(result).toMatchObject({ ok: false, code: 'error' })
      log.mockRestore()
    })
  })

  describe('setTreasuryBankTax', () => {
    it('pide poder cargar: sin eso no llama a la base', async () => {
      vi.mocked(authorizeAccounting).mockResolvedValue({
        ok: false,
        state: { ok: false, code: 'forbidden', message: 'No tenés permiso.' },
      })
      const result = await setTreasuryBankTax(SLUG, { treasuryId: TREASURY, value: false })
      expect(authorizeAccounting).toHaveBeenCalledWith(SLUG, 'write')
      expect(result.ok).toBe(false)
      expect(rpc).not.toHaveBeenCalled()
    })

    it('la cuenta y el valor, y revalida', async () => {
      allow()
      rpc.mockResolvedValue({ data: null, error: null })
      const result = await setTreasuryBankTax(SLUG, { treasuryId: TREASURY, value: false })
      expect(rpc).toHaveBeenCalledWith('acc_set_treasury_bank_tax', {
        p_tenant_id: TENANT,
        p_treasury_id: TREASURY,
        p_value: false,
      })
      expect(result).toMatchObject({
        ok: true,
        data: { treasuryId: TREASURY, value: false },
        message: 'Esta cuenta ya no cobra el impuesto al cheque.',
      })
      expect(revalidatePath).toHaveBeenCalled()
    })

    it('`null` vuelve a «según el tipo»', async () => {
      allow()
      rpc.mockResolvedValue({ data: null, error: null })
      await setTreasuryBankTax(SLUG, { treasuryId: TREASURY, value: null })
      expect(rpc).toHaveBeenCalledWith(
        'acc_set_treasury_bank_tax',
        expect.objectContaining({ p_value: null }),
      )
    })

    it('lo que no es válido no llega a la base', async () => {
      allow()
      for (const raw of [
        { treasuryId: 'cualquiera', value: true },
        { treasuryId: TREASURY, value: 'sí' },
        { treasuryId: TREASURY },
      ]) {
        const result = await setTreasuryBankTax(SLUG, raw)
        expect(result.ok, JSON.stringify(raw)).toBe(false)
      }
      expect(rpc).not.toHaveBeenCalled()
    })

    it('un error de la base llega con su texto, sin revalidar', async () => {
      allow()
      rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_payload' } })
      const result = await setTreasuryBankTax(SLUG, { treasuryId: TREASURY, value: true })
      expect(result.ok).toBe(false)
      expect(revalidatePath).not.toHaveBeenCalled()
    })
  })
})
