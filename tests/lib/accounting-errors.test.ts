import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACC_UNREACHABLE, invalidState } from '@/lib/accounting/action-state'
import {
  ACC_ERROR_KEYS,
  ACC_ERRORS,
  ACC_GENERIC_ERROR,
  type AccErrorKey,
  accErrorMessage,
  CLOSE_WARNING_COPY,
  detailVars,
  engineErrorsState,
  fillTemplate,
  isAccErrorKey,
  mapAccError,
  placeholdersOf,
  WARNING_COPY,
  warningCopy,
  warningCopyWith,
} from '@/lib/accounting/errors'
import { quickExpenseSchema } from '@/lib/accounting/schemas'
import { CLOSE_WARNING_KEYS, WARNING_KEYS } from '@/lib/accounting/types'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** El catálogo de G.4: clave → `code`. */
const G4: Record<string, string> = {
  unauthenticated: 'forbidden',
  forbidden: 'forbidden',
  accounting_not_enabled: 'disabled',
  not_set_up: 'conflict',
  already_set_up: 'conflict',
  not_allowed_to_set_up: 'forbidden',
  target_not_owner: 'invalid',
  last_admin: 'conflict',
  admins_exist: 'conflict',
  access_not_found: 'conflict',
  accountant_requires_acc_admin: 'forbidden',
  protected_accounting_member: 'forbidden',
  invalid_cuit: 'invalid',
  invalid_start_date: 'invalid',
  cash_required: 'invalid',
  sales_point_taken: 'invalid',
  stale: 'stale',
  settings_locked_by_documents: 'conflict',
  fiscal_year_locked: 'conflict',
  code_taken: 'invalid',
  code_invalid: 'invalid',
  code_parent_mismatch: 'invalid',
  parent_is_postable: 'invalid',
  system_account_locked: 'conflict',
  account_has_movements: 'conflict',
  account_has_balance: 'conflict',
  account_in_use: 'conflict',
  account_move_with_children: 'conflict',
  account_delete_forbidden: 'conflict',
  invalid_control_account: 'invalid',
  duplicate_tax_id: 'conflict',
  system_party_locked: 'conflict',
  party_in_use: 'conflict',
  treasury_has_balance: 'conflict',
  treasury_in_use: 'conflict',
  treasury_name_taken: 'conflict',
  treasury_account_invalid: 'error',
  invalid_method_targets: 'invalid',
  invalid_method_party: 'invalid',
  invalid_imputation_account: 'invalid',
  recurring_name_taken: 'invalid',
  opening_locked: 'conflict',
  opening_exists: 'conflict',
  opening_pending: 'conflict',
  invalid_bundle: 'error',
  kind_not_allowed: 'error',
  invalid_line_role: 'error',
  line_account_invalid: 'error',
  fiscal_mismatch: 'error',
  vat_computed_mismatch: 'error',
  treasury_mismatch: 'error',
  sales_method_mismatch: 'error',
  control_party_mismatch: 'error',
  document_without_entry: 'error',
  document_entry_mismatch: 'error',
  acc_immutable: 'error',
  idempotency_conflict: 'conflict',
  preview_stale: 'preview_stale',
  party_required: 'invalid',
  party_not_found: 'invalid',
  party_inactive: 'invalid',
  party_kind_mismatch: 'invalid',
  party_tax_id_required: 'invalid',
  date_before_start: 'invalid',
  date_in_future: 'invalid',
  period_closed: 'conflict',
  period_not_found: 'invalid',
  period_kind_mismatch: 'error',
  entry_date_outside_period: 'error',
  fy_adjustment_date: 'invalid',
  invalid_voucher_for_kind: 'invalid',
  invalid_voucher_for_condition: 'invalid',
  vat_out_of_tolerance: 'invalid',
  vat_not_allowed_for_voucher: 'invalid',
  ddjj_requires_tax_agency: 'invalid',
  total_mismatch: 'invalid',
  duplicate_document: 'conflict',
  duplicate_sales_range: 'conflict',
  daily_close_exists: 'conflict',
  range_required: 'invalid',
  range_invalid: 'invalid',
  invoiced_exceeds_sold: 'invalid',
  cash_count_invalid: 'invalid',
  entry_not_balanced: 'invalid',
  entry_too_few_lines: 'invalid',
  account_requires_party: 'invalid',
  party_not_allowed: 'invalid',
  account_not_found: 'invalid',
  account_not_postable: 'invalid',
  account_inactive: 'invalid',
  item_not_found: 'conflict',
  item_voided: 'conflict',
  allocation_exceeds_open: 'conflict',
  allocation_party_mismatch: 'invalid',
  allocation_side_mismatch: 'invalid',
  allocation_date_invalid: 'invalid',
  mixed_control_accounts: 'invalid',
  credit_without_application: 'invalid',
  compensation_not_allowed: 'invalid',
  compensation_exceeds_balance: 'invalid',
  same_treasury: 'invalid',
  stale_balance: 'stale',
  balance_check_mismatch: 'invalid',
  difference_requires_adjustment: 'invalid',
  adjustment_account_invalid: 'invalid',
  fiscal_voucher_missing: 'error',
  fiscal_voucher_not_allowed: 'error',
  document_not_found: 'conflict',
  document_voided: 'conflict',
  kind_not_voidable: 'conflict',
  cannot_void_closed_period: 'conflict',
  use_void_in_open_period: 'conflict',
  kind_not_reversible: 'conflict',
  already_reversed: 'conflict',
  reversal_date_invalid: 'conflict',
  document_has_allocations: 'conflict',
  allocations_exceed_new_total: 'conflict',
  party_change_with_allocations: 'conflict',
  allocation_not_found: 'conflict',
  allocation_voided: 'conflict',
  allocation_protected: 'conflict',
  undo_expired: 'conflict',
  reason_required: 'invalid',
  period_already_closed: 'conflict',
  period_not_closed: 'conflict',
  month_not_finished: 'conflict',
  close_out_of_order: 'conflict',
  close_warnings: 'needs_confirmation',
  reopen_not_last: 'conflict',
  iva_settlement_paid: 'conflict',
  iva_settlement_exists: 'conflict',
  fiscal_year_closed: 'conflict',
  periods_open: 'conflict',
  next_fiscal_year_closed: 'conflict',
  sas_cuit_required: 'conflict',
  export_too_large: 'invalid',
  reset_after_close: 'conflict',
}

describe('ACC_ERRORS: el catálogo de G.4', () => {
  it('tiene todas las claves de G.4 con su code', () => {
    for (const [key, code] of Object.entries(G4)) {
      expect(isAccErrorKey(key), key).toBe(true)
      expect(ACC_ERRORS[key as AccErrorKey].code, key).toBe(code)
    }
  })

  it('las de E.6, C.0 y F que no estaban en la tabla también tienen copy', () => {
    for (const key of [
      'amount_required',
      'amount_too_large',
      'warning_requires_ack',
      'range_crosses_fiscal_year',
      'export_failed',
    ]) {
      expect(isAccErrorKey(key), key).toBe(true)
    }
  })

  it('toda clave tiene copy; las que tienen huecos, un fallback sin huecos', () => {
    for (const key of ACC_ERROR_KEYS) {
      const def = ACC_ERRORS[key] as {
        message: string
        fallback?: string
        bug?: true
        code: string
      }
      expect(def.message.trim().length, key).toBeGreaterThan(5)
      expect(def.message, key).not.toMatch(/\b(error|invalid|failed)\b/i)
      if (placeholdersOf(def.message).length > 0) {
        expect(def.fallback, `${key} sin fallback`).toBeDefined()
        expect(placeholdersOf(def.fallback ?? ''), key).toEqual([])
      }
      if (def.bug) expect(def.code, key).toBe('error')
    }
  })

  it('sin datos, ningún mensaje deja un hueco a la vista', () => {
    for (const key of ACC_ERROR_KEYS) expect(accErrorMessage(key), key).not.toMatch(/[{}]/)
  })
})

describe('huecos y detail', () => {
  it('fillTemplate completa o avisa que falta', () => {
    expect(fillTemplate('Hola {nombre}', { nombre: 'Franco' })).toBe('Hola Franco')
    expect(fillTemplate('Hola {nombre}', {})).toBeNull()
    expect(fillTemplate('Hola {nombre}', { nombre: '  ' })).toBeNull()
    expect(placeholdersOf('{Mes} está cerrado ({mes})')).toEqual(['Mes', 'mes'])
  })

  it('detailVars traduce los datos crudos de la RPC', () => {
    const vars = detailVars({
      month: '2026-09-01',
      previous_month: '2026-08',
      channel: 'delivery',
      computed_cents: 86_000_000,
      control_cents: 86_000_001,
      debit_cents: 1_000,
      credit_cents: 760,
      party_name: 'coca-Cola',
      voucher_type: 'factura_a',
      point_of_sale: 3,
      number: 1290,
      number_from: 14_501,
      number_to: 14_662,
      rate_bp: 2100,
      condition: 'monotributo',
      date: '2026-10-03',
    })
    expect(vars).toMatchObject({
      Mes: 'Septiembre',
      mes: 'septiembre',
      mesAnterior: 'agosto',
      canal: 'delivery',
      calculado: '$ 860.000,00',
      control: '$ 860.000,01',
      diferencia: '$ 2,40',
      lado: 'Haber',
      nombre: 'coca-Cola',
      Nombre: 'Coca-Cola',
      tipo: 'Factura A',
      numero: '0003-00001290',
      rango: '0003-00014501 a 0003-00014662',
      alicuota: '21 %',
      condicion: 'monotributista',
      fecha: '03/10/2026',
    })
  })

  it('mensajes completos con los datos', () => {
    expect(accErrorMessage('period_closed', detailVars({ month: '2026-09-01' }))).toBe(
      'Septiembre está cerrado. Cargalo con fecha de un mes abierto o corregilo con una nota de crédito o un ajuste.',
    )
    expect(
      accErrorMessage(
        'entry_not_balanced',
        detailVars({ debit_cents: 1_000, credit_cents: 2_240 }),
      ),
    ).toBe('El asiento no cuadra: falta $ 12,40 en el Debe.')
    expect(
      accErrorMessage(
        'invalid_voucher_for_condition',
        detailVars({ condition: 'monotributo', voucher_type: 'factura_a' }),
      ),
    ).toBe('Un monotributista no emite Factura A. Revisá el tipo o la condición del proveedor.')
    expect(
      accErrorMessage('total_mismatch', detailVars({ computed_cents: 100, control_cents: 101 })),
    ).toBe('Los importes suman $ 1,00 y el comprobante dice $ 1,01.')
  })
})

describe('mapAccError: errores de supabase-js / PostgREST → estado de la acción', () => {
  it('clave de negocio (P0001) con su detail', () => {
    const state = mapAccError({
      code: 'P0001',
      message: 'period_closed',
      details: '{"month":"2026-09-01"}',
      hint: null,
    })
    expect(state).toMatchObject({ ok: false, code: 'conflict' })
    expect(state.message).toBe(
      'Septiembre está cerrado. Cargalo con fecha de un mes abierto o corregilo con una nota de crédito o un ajuste.',
    )
    expect(state.detail).toMatchObject({ key: 'period_closed', month: '2026-09-01' })
  })

  it('la clave aparece como palabra entera aunque el mensaje sea más largo', () => {
    expect(mapAccError({ message: 'ERROR: stale_balance at line 4' }).code).toBe('stale')
    // `stale` no se confunde con `stale_balance` ni con `preview_stale`.
    expect(mapAccError({ message: 'preview_stale' }).code).toBe('preview_stale')
    expect(mapAccError({ message: 'cannot_void_closed_period' }).detail?.key).toBe(
      'cannot_void_closed_period',
    )
  })

  it('42501 sin clave → forbidden; con clave, la clave', () => {
    expect(
      mapAccError({ code: '42501', message: 'permission denied for function acc_post_bundle' })
        .message,
    ).toBe(ACC_ERRORS.forbidden.message)
    expect(mapAccError({ code: '42501', message: 'unauthenticated' }).message).toBe(
      ACC_ERRORS.unauthenticated.message,
    )
  })

  it('23505 por constraint', () => {
    expect(
      mapAccError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "adoc_purchase_dup_uq"',
      }).detail?.key,
    ).toBe('duplicate_document')
    expect(
      mapAccError({ code: '23505', message: 'x', details: 'Key ... adoc_close_day_uq' }).detail
        ?.key,
    ).toBe('daily_close_exists')
    expect(mapAccError({ code: '23505', message: 'unique "abd_client_ref_uq"' }).detail?.key).toBe(
      'request_replayed',
    )
    expect(mapAccError({ code: '23505', message: 'unique "otra_cosa"' }).detail?.key).toBe(
      'duplicate',
    )
  })

  it('23503 según la operación', () => {
    expect(mapAccError({ code: '23503', message: 'fk' }, { operation: 'delete' }).detail?.key).toBe(
      'in_use',
    )
    expect(mapAccError({ code: '23503', message: 'fk' }).detail?.key).toBe('not_found')
  })

  it('función que todavía no existe (código desplegado antes que la migración)', () => {
    const state = mapAccError({
      code: 'PGRST202',
      message: 'Could not find the function public.acc_post_bundle',
    })
    expect(state.message).toBe(ACC_UNREACHABLE.notDeployed)
    expect(mapAccError({ code: '42883', message: 'function does not exist' }).message).toBe(
      ACC_UNREACHABLE.notDeployed,
    )
  })

  it('sin conexión', () => {
    expect(mapAccError({ message: 'TypeError: fetch failed', code: '' }).message).toBe(
      ACC_UNREACHABLE.offline,
    )
  })

  it('timeout, serialización y check', () => {
    expect(
      mapAccError({ code: '57014', message: 'canceling statement due to statement timeout' }).detail
        ?.key,
    ).toBe('timeout')
    expect(mapAccError({ code: '40001', message: 'could not serialize' }).detail?.key).toBe('retry')
    expect(
      mapAccError({ code: '23514', message: 'violates check constraint' }).detail,
    ).toMatchObject({
      key: 'check_violation',
      bug: true,
    })
  })

  it('desconocido o nulo → genérico, sin mostrar el mensaje crudo', () => {
    const state = mapAccError({
      code: 'XX000',
      message: 'internal: secret table acc_documents broke',
    })
    expect(state).toEqual({ ok: false, code: 'error', message: ACC_GENERIC_ERROR })
    expect(mapAccError(null)).toEqual({ ok: false, code: 'error', message: ACC_GENERIC_ERROR })
  })

  it('las claves «bug» muestran el genérico y lo marcan para el log', () => {
    const state = mapAccError({
      code: 'P0001',
      message: 'fiscal_mismatch',
      details: '{"document":"d1","line_no":3}',
    })
    expect(state.code).toBe('error')
    expect(state.message).toContain('No pudimos armar el asiento')
    expect(state.detail).toMatchObject({
      key: 'fiscal_mismatch',
      bug: true,
      document: 'd1',
      line_no: 3,
    })
  })

  it('invalid_report_param (parámetro de reporte inválido) es un bug con su texto', () => {
    const state = mapAccError({
      code: 'P0001',
      message: 'invalid_report_param',
      details: '{"param":"p_side"}',
    })
    expect(state.code).toBe('error')
    expect(state.message).toBe(
      'No pudimos armar el reporte. Recargá la página y probá de nuevo; si sigue, avisanos.',
    )
    expect(state.detail).toMatchObject({ key: 'invalid_report_param', bug: true, param: 'p_side' })
  })

  it('warning_requires_ack trae todos los avisos juntos, con su texto y sus botones', () => {
    const state = mapAccError({
      code: 'P0001',
      message: 'warning_requires_ack',
      details: JSON.stringify({
        warnings: [
          { key: 'treasury_negative', treasury_name: 'Caja', balance_after_cents: -230_000 },
          'voucher_m',
          { key: 'desconocido' },
        ],
      }),
    })
    expect(state.code).toBe('needs_confirmation')
    expect(state.warnings).toEqual([
      {
        key: 'treasury_negative',
        message: 'Caja quedaría en −$ 2.300,00. ¿Falta cargar algún ingreso o el cierre del día?',
        confirmLabel: 'Guardar igual',
        cancelLabel: 'Revisar',
      },
      {
        key: 'voucher_m',
        message:
          'Factura M: puede corresponder retener IVA y Ganancias. Consultalo con la contadora.',
        confirmLabel: 'Entendido',
        cancelLabel: null,
      },
    ])
  })

  it('los datos del formulario completan lo que no trae el detail', () => {
    const state = mapAccError(
      { code: 'P0001', message: 'party_tax_id_required' },
      { vars: { nombre: 'Coca-Cola' } },
    )
    expect(state.message).toBe('Para que entre al Libro IVA, completá el CUIT de Coca-Cola.')
  })
})

describe('engineErrorsState e invalidState', () => {
  it('el primer error por campo y el primero de todos como mensaje', () => {
    const state = engineErrorsState([
      { key: 'party_required', field: 'party' },
      { key: 'party_inactive', field: 'party' },
      {
        key: 'date_before_start',
        field: 'accountingDate',
        detail: { books_start_date: '2026-10-01' },
      },
    ])
    expect(state.code).toBe('invalid')
    expect(state.message).toBe('Elegí el proveedor o cliente.')
    expect(state.fieldErrors).toEqual({
      party: 'Elegí el proveedor o cliente.',
      accountingDate:
        'Administración arranca el 01/10/2026: lo de antes va en los saldos iniciales.',
    })
  })

  it('sin errores → genérico', () => {
    expect(engineErrorsState([])).toEqual({ ok: false, code: 'error', message: ACC_GENERIC_ERROR })
  })

  it('invalidState arma los errores por campo desde zod', () => {
    const parsed = quickExpenseSchema.safeParse({})
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const state = invalidState(parsed.error)
    expect(state.code).toBe('invalid')
    expect(state.fieldErrors?.amountCents).toBe('Falta el importe.')
    expect(state.fieldErrors?.date).toBe('Elegí una fecha.')
  })
})

describe('avisos confirmables (warningCopy)', () => {
  it('todos los avisos tienen texto, fallback sin huecos y botón de confirmar', () => {
    expect(Object.keys(WARNING_COPY).sort()).toEqual([...WARNING_KEYS].sort())
    for (const key of WARNING_KEYS) {
      const copy = warningCopy({ key })
      expect(copy.message, key).not.toMatch(/[{}]/)
      expect(copy.confirmLabel.length, key).toBeGreaterThan(0)
    }
  })

  it('completa con los datos del aviso', () => {
    expect(
      warningCopy({ key: 'vat_diff', detail: { rate_bp: 2100, diff_cents: 37 } }).message,
    ).toBe('El IVA no coincide con el 21 % del neto (diferencia: $ 0,37). ¿Está así en la factura?')
    expect(
      warningCopy({
        key: 'possible_duplicate',
        detail: { amount_cents: 360_000, party_name: 'Coca-Cola', date: '2026-10-05' },
      }).message,
    ).toBe('Ya cargaste algo igual ($ 3.600,00 · Coca-Cola · 05/10/2026). ¿Es otro?')
    expect(
      warningCopy({
        key: 'invoiced_exceeds_sold',
        detail: { channel: 'delivery', invoiced_cents: 9_680_000, sold_cents: 8_000_000 },
      }).message,
    ).toBe(
      'En delivery facturaste $ 96.800,00 y vendiste $ 80.000,00. ¿Es una factura de otro día? (Contá por qué)',
    )
    expect(
      warningCopy({
        key: 'late_registration',
        detail: { issue_date: '2026-07-20', accounting_month: '2026-10' },
      }).message,
    ).toBe('La factura es del 20/07/2026. Va al Libro IVA de octubre.')
  })

  it('sirve directo en un map (G.3: `pending.map(warningCopy)`) y acepta datos del formulario', () => {
    const copies = [{ key: 'voucher_m' as const }, { key: 'write_off' as const }].map(warningCopy)
    expect(copies.map((c) => c.key)).toEqual(['voucher_m', 'write_off'])
    expect(
      warningCopyWith({ key: 'amount_looks_off' }, { proveedor: 'Coca-Cola', mediana: '$ 120.000' })
        .message,
    ).toBe('¿Seguro? Con Coca-Cola solés gastar alrededor de $ 120.000.')
  })

  it('los avisos del cierre de mes tienen texto', () => {
    for (const key of CLOSE_WARNING_KEYS)
      expect(CLOSE_WARNING_COPY[key].length, key).toBeGreaterThan(5)
  })
})

// ─── Paridad con la SQL (§I.4) ───────────────────────────────────────────────

/**
 * Las migraciones de Administración: las `*_acc_*` y la de aislamiento de la
 * contadora (B.7). No alcanza con `*acc*`: matchea «auto_accept» del salón.
 */
function accountingMigrations(): string[] {
  const dir = join(ROOT, 'supabase/migrations')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && (/_acc_/.test(f) || /_accountant_isolation\.sql$/.test(f)))
    .map((f) => join(dir, f))
}

describe('paridad: toda clave que levanta la SQL tiene copy (§I.4)', () => {
  const files = accountingMigrations()

  it.skipIf(files.length === 0)(
    'las claves de `raise exception` de las migraciones acc_* están en ACC_ERRORS',
    () => {
      const missing = new Set<string>()
      for (const file of files) {
        const sql = readFileSync(file, 'utf8')
        for (const m of sql.matchAll(/raise exception '([a-z0-9_]+)'/g)) {
          const key = m[1] ?? ''
          if (!isAccErrorKey(key)) missing.add(`${key} (${file.split('/').pop()})`)
        }
      }
      expect([...missing]).toEqual([])
    },
  )
})
