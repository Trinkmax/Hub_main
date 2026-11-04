'use server'

/**
 * Las acciones de la planilla de Sueldos. Los importes llegan en centavos enteros: la celda y el
 * campo de plata convierten en el borde. Nunca se loguean nombres ni importes: solo la operación y
 * el código.
 *
 * - `saveEmployee`, `saveEmployeeSalary`: una RPC que audita adentro (`runSimpleRpc`).
 * - `postPayrollMovement`, `postPayrollAccrual`: primero dejan anotado a qué empleado o a qué mes
 *   corresponde ese `clientRef` y después siguen el camino de todo comprobante (`runPostDocument`:
 *   vista previa, avisos, `acc_post_bundle`). Si el comprobante no se guarda, lo anotado no cuenta:
 *   `acc_report_payroll` solo lee los que tienen comprobante vigente. Reintentar con el mismo
 *   `clientRef` no duplica nada.
 */

import { authorizeAccounting } from '@/lib/accounting/access'
import {
  type AccActionState,
  type AccFailureState,
  type AccSimpleState,
  invalidState,
} from '@/lib/accounting/action-state'
import { ACC_GENERIC_ERROR, mapAccError } from '@/lib/accounting/errors'
import {
  type EmployeeSalaryValues,
  type EmployeeValues,
  employeeSalarySchema,
  employeeSchema,
  type PayrollAccrualInput,
  type PayrollMovementInput,
  payrollAccrualTargetSchema,
  payrollMovementTargetSchema,
} from '@/lib/accounting/payroll'
import { errorName, logFailure, runPostDocument } from '@/lib/accounting/server/post-document'
import { runSimpleRpc } from '@/lib/accounting/server/simple-rpc'
import { createClient } from '@/lib/supabase/server'

const GENERIC: AccFailureState = { ok: false, code: 'error', message: ACC_GENERIC_ERROR }

/** Agregar o editar a alguien del equipo (o darlo de baja: un empleado con movimientos no se borra). */
export async function saveEmployee(
  slug: string,
  input: EmployeeValues,
): Promise<AccSimpleState<{ id: string }>> {
  return runSimpleRpc(slug, input, {
    op: 'payroll.employee',
    schema: employeeSchema,
    call: (tenantId, v) => ({
      fn: 'acc_save_employee',
      args: {
        p_tenant_id: tenantId,
        p_employee: {
          id: v.id,
          name: v.name,
          pay_frequency: v.payFrequency,
          active: v.active,
          notes: v.notes,
        },
      },
    }),
    done: (data, v) => ({
      data: { id: idOf(data, v.id) },
      message: v.id === null ? 'Empleado agregado.' : 'Empleado guardado.',
    }),
  })
}

function idOf(data: unknown, fallback: string | null): string {
  if (typeof data === 'object' && data !== null && 'id' in data && typeof data.id === 'string') {
    return data.id
  }
  return fallback ?? ''
}

/** El sueldo de alguien desde ese mes (los siguientes lo heredan). */
export async function saveEmployeeSalary(
  slug: string,
  input: EmployeeSalaryValues,
): Promise<AccSimpleState> {
  return runSimpleRpc(slug, input, {
    op: 'payroll.salary',
    schema: employeeSalarySchema,
    call: (tenantId, v) => ({
      fn: 'acc_save_employee_salary',
      args: {
        p_tenant_id: tenantId,
        p_employee_id: v.employeeId,
        p_month: `${v.month}-01`,
        p_salary_cents: v.salaryCents,
      },
    }),
    done: () => ({ data: undefined, message: 'Sueldo guardado.' }),
  })
}

/** Una RPC que prepara el envío: su error vuelve al formulario como cualquier otro. */
async function prepareFailure(
  op: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<AccFailureState | null> {
  const supabase = await createClient()
  const { error } = await supabase.rpc(fn, args)
  if (!error) return null
  const state = mapAccError(error)
  logFailure(op, state, error.code)
  return state
}

/** Un adelanto o un pago de sueldo: `cash_movement` D Sueldos a pagar [Personal] / H la caja. */
export async function postPayrollMovement(
  slug: string,
  input: PayrollMovementInput,
): Promise<AccActionState> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = payrollMovementTargetSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const { employeeId, month, kind, ...movement } = parsed.data

    const failure = await prepareFailure('payroll.movement', 'acc_payroll_prepare_movement', {
      p_tenant_id: auth.tenantId,
      p_client_ref: movement.clientRef,
      p_employee_id: employeeId,
      p_month: `${month}-01`,
      p_kind: kind,
    })
    if (failure) return failure

    return await runPostDocument(slug, 'cash_movement', movement)
  } catch (error) {
    console.error('[accounting.documents.payroll.movement] inesperado', errorName(error))
    return GENERIC
  }
}

/** «Devengar el mes»: asiento manual D Sueldos y jornales / H Sueldos a pagar [Personal]. */
export async function postPayrollAccrual(
  slug: string,
  input: PayrollAccrualInput,
): Promise<AccActionState> {
  try {
    const auth = await authorizeAccounting(slug, 'write')
    if (!auth.ok) return auth.state
    const parsed = payrollAccrualTargetSchema.safeParse(input)
    if (!parsed.success) return invalidState(parsed.error)
    const { month, ...entry } = parsed.data

    const failure = await prepareFailure('payroll.accrual', 'acc_payroll_prepare_accrual', {
      p_tenant_id: auth.tenantId,
      p_client_ref: entry.clientRef,
      p_month: `${month}-01`,
    })
    if (failure) return failure

    return await runPostDocument(slug, 'manual_entry', entry)
  } catch (error) {
    console.error('[accounting.documents.payroll.accrual] inesperado', errorName(error))
    return GENERIC
  }
}
