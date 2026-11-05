import { describe, expect, it } from 'vitest'
import type { AccountingSettings } from '@/lib/accounting/queries/settings'
import { DEFAULT_TAX_SETTINGS } from '@/lib/accounting/taxes'
import { settingsData } from '@/lib/tex/tools/read/ajustes'

const SETTINGS: AccountingSettings = {
  legalName: 'HUB Coffee & Bar SAS',
  cuit: '30712345678',
  ivaCondition: 'responsable_inscripto',
  iibbRegime: 'local',
  iibbNumber: '123',
  iibbJurisdictionCode: 904,
  activityStartDate: '2024-03-01',
  fiscalAddress: 'Bv. San Juan 100, Córdoba',
  booksStartDate: '2026-10-12',
  fiscalYearEndMonth: 12,
  ivaSettlementMode: 'on_close',
  ivaDueDay: 20,
  iibbDueDay: 15,
  vatToleranceCents: 1,
  bankTaxCreditComputableBp: 3300,
  bankTaxDebitComputableBp: 3300,
  uninvoicedSalesMode: 'separate_accounts',
  closedPeriodVoidIvaMode: 'adjustment_only',
  dueSoonDays: 7,
  openingStatus: 'pending',
  setupCompletedAt: '2026-10-12T10:00:00Z',
  updatedAt: '2026-10-12T10:00:00Z',
  hasDocuments: true,
  hasClosedPeriods: false,
}

describe('ver_ajustes', () => {
  it('los datos del bar, sus libros y los impuestos en porcentajes', () => {
    expect(settingsData(SETTINGS, DEFAULT_TAX_SETTINGS, [{ number: 3, label: 'Salón' }])).toEqual({
      bar: {
        razon_social: 'HUB Coffee & Bar SAS',
        cuit: '30712345678',
        condicion_iva: 'Responsable inscripto',
        ingresos_brutos: 'Local (Córdoba)',
        inicio_de_actividades: '01/03/2024',
        domicilio_fiscal: 'Bv. San Juan 100, Córdoba',
      },
      libros: {
        arrancan: '12/10/2026',
        saldos_iniciales: 'Faltan cargar',
        cierre_del_ejercicio_mes: 12,
        liquidacion_de_iva: 'Al cerrar cada mes',
        iva_vence_el_dia: 20,
        ingresos_brutos_vence_el_dia: 15,
      },
      impuestos: {
        se_calculan_solos: true,
        ingresos_brutos: '3 %',
        comercio_e_industria: '0,7 %',
        impuesto_al_cheque: '0,6 %',
        base: 'Sobre lo facturado, sin IVA',
      },
      puntos_de_venta: [{ numero: 3, nombre: 'Salón' }],
    })
  })

  it('sin configurar, lo dice', () => {
    const data = settingsData(null, DEFAULT_TAX_SETTINGS, [])
    expect(data.bar).toBe('Administración todavía no está configurada.')
    expect(data.libros).toBeUndefined()
    expect(data.puntos_de_venta).toBeUndefined()
  })

  it('si los impuestos no se pudieron leer, no inventa porcentajes', () => {
    expect(settingsData(SETTINGS, null, []).impuestos).toBe('No se pudieron leer.')
  })

  it('un dato que falta no aparece', () => {
    const data = settingsData(
      { ...SETTINGS, cuit: null, fiscalAddress: null, activityStartDate: null },
      DEFAULT_TAX_SETTINGS,
      [],
    )
    expect(data.bar).toEqual({
      razon_social: 'HUB Coffee & Bar SAS',
      condicion_iva: 'Responsable inscripto',
      ingresos_brutos: 'Local (Córdoba)',
    })
  })
})
