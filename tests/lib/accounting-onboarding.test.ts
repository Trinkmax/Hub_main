/**
 * «Cómo arrancar» y las integraciones del Resumen (diseño §5.2.3–§5.2.4, WP6):
 * lo que devuelve `acc_report_onboarding` en camelCase, el estado de cada
 * ítem de la guía (con las marcas «Ya lo hice») y los avisos de ARCA, Mercado
 * Pago, el banco y Mis Comprobantes para «Para atender». Todo puro.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  type OnboardingData,
  onboardingState,
  parseOnboardingData,
  supplierRequestMessage,
} from '@/lib/accounting/onboarding'
import {
  type IntegrationsStatus,
  integrationAttention,
} from '@/lib/accounting/queries/integrations'

const RAW = {
  today: '2026-10-15',
  sas_missing: [],
  bank_with_cbu: true,
  wallet_with_cvu: true,
  sales_methods: 6,
  sales_points: '2',
  opening_done: true,
  partner_granted: true,
  accountant_added: true,
  arca: { status: 'connected', cert_not_after: '2028-10-01T00:00:00Z', emission_enabled: false },
  arca_vouchers_attention: 0,
  mp: { status: 'csv_only', last_sync_at: null, last_error_key: null },
  imports: {
    arca_recibidos: { last_batch_at: '2026-10-11T13:00:00Z', posted_batches: 1, pending_review: 0 },
    mp_release: { last_batch_at: '2026-10-09T13:00:00Z', posted_batches: 2, pending_review: 0 },
    bank_statement: { last_batch_at: '2026-10-01T13:00:00Z', posted_batches: 1, pending_review: 1 },
  },
  mc_prev_month_covered: true,
  recurring_active: 4,
  daily_close_missing: 0,
  mp_invoice_this_month: false,
  treasuries_unchecked: 2,
  prev_month_closed: false,
  manual: ['suppliers_message', 42],
}

function data(patch: Record<string, unknown> = {}): OnboardingData {
  const d = parseOnboardingData({ ...RAW, ...patch })
  if (!d) throw new Error('No se pudo leer')
  return d
}

const EMPTY = {
  sas_missing: ['cuit', 'iibb_number', 'activity_start_date', 'fiscal_address'],
  bank_with_cbu: false,
  wallet_with_cvu: false,
  sales_methods: 0,
  sales_points: 0,
  opening_done: false,
  partner_granted: false,
  accountant_added: false,
  arca: null,
  mp: null,
  imports: {},
  mc_prev_month_covered: false,
  recurring_active: 0,
  daily_close_missing: 7,
  treasuries_unchecked: 1,
  manual: [],
}

describe('lo que devuelve la base', () => {
  it('pasa a camelCase, con los números que llegan como texto y sin lo que no conoce', () => {
    const d = data({ sas_missing: ['cuit', 'otra'] })
    expect(d).toMatchObject({
      today: '2026-10-15',
      sasMissing: ['cuit'],
      salesPoints: 2,
      arca: { status: 'connected', certNotAfter: '2028-10-01T00:00:00Z', emissionEnabled: false },
      mp: { status: 'csv_only', lastSyncAt: null, lastErrorKey: null },
      imports: {
        bank_statement: { lastBatchAt: '2026-10-01T13:00:00Z', postedBatches: 1, pendingReview: 1 },
      },
      treasuriesUnchecked: 2,
      manual: ['suppliers_message'],
    })
    expect(d.imports.arca_emitidos).toBeUndefined()
  })

  it('sin un día válido no es un reporte', () => {
    expect(parseOnboardingData(null)).toBeNull()
    expect(parseOnboardingData([])).toBeNull()
    expect(parseOnboardingData({ ...RAW, today: '2026-02-30' })).toBeNull()
  })
})

describe('el estado de la guía', () => {
  it('cuenta lo listo (sin los informativos ni los opcionales) y elige lo próximo', () => {
    const s = onboardingState(data())
    expect({ done: s.done, total: s.total, next: s.next }).toEqual({
      done: 13,
      total: 17,
      next: 'bank_weekly',
    })
    expect(s.sections).toEqual({
      day1: { done: 10, total: 10 },
      daily: { done: 1, total: 1 },
      weekly: { done: 1, total: 2 },
      monthly: { done: 1, total: 4 },
    })
    const by = new Map(s.items.map((i) => [i.id, i]))
    expect(by.get('mp_weekly')?.status).toBe('done')
    expect(by.get('bank_weekly')).toMatchObject({
      status: 'todo',
      pending: 'Hay un extracto para revisar.',
    })
    expect(by.get('treasury_check')?.pending).toBe('Faltan ajustar 2 cajas este mes.')
    expect(by.get('month_close')?.pending).toBe('El mes pasado sigue abierto.')
    expect(by.get('small_expenses')?.status).toBe('info')
    expect(by.get('suppliers_message')).toMatchObject({ status: 'done', manualDone: true })
    expect(by.get('mp_connect')).toMatchObject({ status: 'done', optional: true })
  })

  it('un bar recién empezado: todo pendiente, con el porqué en palabras simples', () => {
    const s = onboardingState(
      data({ ...EMPTY, mp: { status: 'reconnect' }, arca: { status: 'error' } }),
    )
    const by = new Map(s.items.map((i) => [i.id, i]))
    expect(s.next).toBe('sas_data')
    expect(by.get('sas_data')?.pending).toBe(
      'Falta la CUIT, el número de Ingresos Brutos, el inicio de actividades y el domicilio fiscal.',
    )
    expect(by.get('treasuries')?.pending).toBe('Falta el CBU del banco.')
    expect(by.get('access')?.pending).toBe('Faltan tu socio y la contadora.')
    expect(by.get('arca')?.pending).toBe('La última prueba dio error.')
    expect(by.get('recurring')?.pending).toBe('Todavía no hay gastos fijos.')
    expect(by.get('mp_connect')?.pending).toBe('Hay que volver a conectar Mercado Pago.')
    expect(by.get('daily_close')?.pending).toBe('Faltan 7 cierres de la última semana.')
    expect(by.get('treasury_check')?.pending).toBe('Falta ajustar 1 caja este mes.')
    expect(s.done).toBe(0)
  })

  it('«Ya lo hice» solo vale en los pasos que lo aceptan', () => {
    const d = data({ ...EMPTY, recurring_active: 1 })
    const s = onboardingState(d, ['treasuries', 'opening', 'recurring'])
    const by = new Map(s.items.map((i) => [i.id, i]))
    expect(by.get('treasuries')).toMatchObject({ status: 'done', manualDone: true, pending: null })
    expect(by.get('recurring')).toMatchObject({ status: 'done', manualDone: true })
    // Los saldos iniciales los verifica la plataforma: la marca no alcanza.
    expect(by.get('opening')).toMatchObject({ status: 'todo', manualDone: false })
  })

  it('si la plataforma ya lo vio hecho, no figura como marcado a mano', () => {
    const s = onboardingState(data(), ['treasuries'])
    expect(s.items.find((i) => i.id === 'treasuries')).toMatchObject({
      status: 'done',
      manualDone: false,
    })
  })

  it('el mensaje para los proveedores, con y sin la CUIT', () => {
    expect(supplierRequestMessage({ legalName: ' Bar de Prueba sas ', cuit: '30712345678' })).toBe(
      'Hola, desde ahora facturanos a BAR DE PRUEBA SAS, CUIT 30-71234567-8, Responsable inscripto, con Factura A. ¡Gracias!',
    )
    expect(supplierRequestMessage({ legalName: 'Bar de Prueba SAS', cuit: null })).toBe(
      'Hola, desde ahora facturanos a BAR DE PRUEBA SAS, Responsable inscripto, con Factura A. ¡Gracias!',
    )
  })
})

// ─── Integraciones ───────────────────────────────────────────────────────────

const NO_SOURCE = { lastBatchAt: null, pendingBatches: 0, pendingBatchId: null }

function status(patch: Partial<IntegrationsStatus> = {}): IntegrationsStatus {
  return {
    available: true,
    today: '2026-10-15',
    arca: { produccion: null, homologacion: null, vouchersAttention: 0 },
    mercadoPago: { ...NO_SOURCE, status: 'csv_only', lastSyncAt: null, lastErrorKey: null },
    bank: { ...NO_SOURCE },
    arcaImports: { ...NO_SOURCE, used: false, prevMonthCovered: false },
    ...patch,
  }
}

function prod(
  patch: Partial<NonNullable<IntegrationsStatus['arca']['produccion']>>,
): IntegrationsStatus['arca'] {
  return {
    produccion: {
      environment: 'produccion',
      status: 'connected',
      pointOfSale: 3,
      certNotAfter: '2028-10-01T15:00:00Z',
      certDaysLeft: 717,
      lastTestAt: '2026-10-01T12:00:00Z',
      lastErrorKey: null,
      emissionEnabled: true,
      ...patch,
    },
    homologacion: null,
    vouchersAttention: 0,
  }
}

describe('«Para atender» de las integraciones', () => {
  it('sin las tablas todavía, o con todo en orden: nada', () => {
    expect(integrationAttention(status({ available: false }))).toEqual([])
    expect(
      integrationAttention(
        status({
          arca: prod({}),
          arcaImports: { ...NO_SOURCE, used: true, prevMonthCovered: true },
        }),
      ),
    ).toEqual([])
  })

  it('ARCA con error y el certificado por vencer', () => {
    const out = integrationAttention(
      status({
        arca: prod({ status: 'error', certNotAfter: '2026-11-04T15:00:00Z', certDaysLeft: 20 }),
        arcaImports: { ...NO_SOURCE, used: true, prevMonthCovered: true },
      }),
    )
    expect(out).toEqual([
      expect.objectContaining({ kind: 'arca_error', tone: 'danger', href: '/ajustes?tab=arca' }),
      expect.objectContaining({
        kind: 'arca_cert_expiring',
        tone: 'warning',
        label: 'El certificado de ARCA vence el 04/11/2026.',
        date: '2026-11-04',
      }),
    ])
  })

  it('el certificado vencido es urgente; uno sin usar (borrador) no avisa', () => {
    const expired = integrationAttention(
      status({ arca: prod({ certNotAfter: '2026-10-13T15:00:00Z', certDaysLeft: -2 }) }),
    )
    expect(expired[0]).toMatchObject({
      kind: 'arca_cert_expired',
      tone: 'danger',
      label: 'El certificado de ARCA venció el 13/10/2026.',
    })
    expect(
      integrationAttention(
        status({
          arca: prod({ status: 'draft', certNotAfter: '2026-10-13T15:00:00Z', certDaysLeft: -2 }),
        }),
      ).map((i) => i.kind),
    ).not.toContain('arca_cert_expired')
  })

  it('lotes para revisar: uno lleva directo al lote; varios, a la lista', () => {
    const out = integrationAttention(
      status({
        bank: { lastBatchAt: '2026-10-14T12:00:00Z', pendingBatches: 1, pendingBatchId: 'lote-1' },
        mercadoPago: {
          lastBatchAt: '2026-10-14T12:00:00Z',
          pendingBatches: 2,
          pendingBatchId: 'lote-2',
          status: 'csv_only',
          lastSyncAt: null,
          lastErrorKey: null,
        },
      }),
    )
    expect(out).toEqual([
      expect.objectContaining({
        kind: 'import_review',
        label: 'Hay 2 reportes de Mercado Pago para revisar.',
        href: '/importar',
        count: 2,
      }),
      expect.objectContaining({
        kind: 'import_review',
        label: 'Movimientos del banco para revisar y cargar.',
        href: '/importar/lote-1',
        count: 1,
      }),
    ])
  })

  it('Mis Comprobantes del mes anterior: desde el día 11, si se usa ARCA y ningún lote lo cubre', () => {
    const used = { ...NO_SOURCE, used: true, prevMonthCovered: false }
    expect(integrationAttention(status({ arcaImports: used }))).toEqual([
      expect.objectContaining({
        kind: 'mc_prev_month',
        tone: 'info',
        label: 'Bajá Mis Comprobantes de septiembre y subilo: ya están casi todas las facturas.',
      }),
    ])
    expect(integrationAttention(status({ arcaImports: used, today: '2026-10-10' }))).toEqual([])
    expect(
      integrationAttention(status({ arcaImports: { ...used, prevMonthCovered: true } })),
    ).toEqual([])
    expect(integrationAttention(status()).map((i) => i.kind)).toEqual([])
    // Con ARCA conectado alcanza (aunque nunca se haya importado).
    expect(integrationAttention(status({ arca: prod({}) })).map((i) => i.kind)).toEqual([
      'mc_prev_month',
    ])
    // En enero, el mes anterior es diciembre.
    expect(
      integrationAttention(status({ arcaImports: used, today: '2027-01-12' }))[0]?.label,
    ).toContain('de diciembre')
  })

  it('primero lo urgente, después lo que conviene mirar y al final lo informativo', () => {
    const out = integrationAttention(
      status({
        arca: {
          ...prod({ status: 'error', certDaysLeft: 10, certNotAfter: '2026-10-25T15:00:00Z' }),
          vouchersAttention: 3,
        },
        mercadoPago: {
          ...NO_SOURCE,
          status: 'reconnect',
          lastSyncAt: null,
          lastErrorKey: 'mp_token_invalid',
        },
        bank: { lastBatchAt: null, pendingBatches: 1, pendingBatchId: 'lote-1' },
        arcaImports: { ...NO_SOURCE, used: true, prevMonthCovered: false },
      }),
    )
    expect(out.map((i) => i.kind)).toEqual([
      'arca_error',
      'arca_vouchers',
      'arca_cert_expiring',
      'mp_reconnect',
      'import_review',
      'mc_prev_month',
    ])
    expect(out[1]?.label).toBe('Hay 3 facturas de ARCA para verificar o cargar en los libros.')
  })
})
