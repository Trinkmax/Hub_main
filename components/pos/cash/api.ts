import type { ActionResult } from '@/lib/pos/actions'
import type {
  CashMovementInput,
  CloseShiftInput,
  EditPaymentInput,
  OpenShiftInput,
} from '@/lib/pos/cash/actions'
import type {
  CashMovementResult,
  CloseShiftResult,
  EditPaymentResult,
  OpenShiftResult,
  ShiftSnapshot,
  VoidPaymentResult,
} from '@/lib/pos/cash/types'

/**
 * Lo que la pantalla de caja le pide al servidor. La pantalla no sabe de dónde sale: en la app son
 * las acciones de `lib/pos/cash/actions.ts` (ver `cash-live.tsx`), ya atadas al bar.
 */
export type CashApi = {
  /** La caja de la sucursal: el turno abierto (o el último), uno puntual, o el carril de práctica. */
  refresh: (
    branchId: string,
    options: { shiftId?: string | null; practice?: boolean },
  ) => Promise<ActionResult<ShiftSnapshot>>
  open: (input: OpenShiftInput) => Promise<ActionResult<OpenShiftResult>>
  move: (input: CashMovementInput) => Promise<ActionResult<CashMovementResult>>
  voidMove: (movementId: string, why: string) => Promise<ActionResult<CashMovementResult>>
  close: (input: CloseShiftInput) => Promise<ActionResult<CloseShiftResult>>
  edit: (input: EditPaymentInput) => Promise<ActionResult<EditPaymentResult>>
  voidPay: (paymentId: string, why: string) => Promise<ActionResult<VoidPaymentResult>>
  /** Pasar a trabajar en otra sucursal (queda guardado en el dispositivo). */
  setBranch: (branchId: string) => Promise<ActionResult>
}

export type Failure = { ok: false; message: string; code: string }

const NO_SIGNAL: Failure = {
  ok: false,
  message: 'No hay señal: no se guardó. Probá de nuevo cuando vuelva.',
  code: 'network',
}

/**
 * Una llamada al servidor que nunca tira: si se cortó la red, devuelve un error que se puede leer
 * (y lo que se estaba escribiendo sigue en pantalla para reintentar).
 */
export async function attempt<T extends { ok: boolean }>(
  call: () => Promise<T>,
): Promise<T | Failure> {
  try {
    return await call()
  } catch {
    return NO_SIGNAL
  }
}

/** Una clave por toque: reintentar sin señal nunca anota dos veces. */
export function newKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
