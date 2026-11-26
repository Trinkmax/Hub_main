'use client'

import { useCallback, useMemo } from 'react'
import { setActiveBranch } from '@/lib/pos/actions'
import {
  cashMovement,
  cashTargets,
  checkOpeningCount,
  checkShiftCount,
  closeShift,
  editPayment,
  openShift,
  refreshShift,
  voidCashMovement,
  voidPayment,
} from '@/lib/pos/cash/actions'
import type { ShiftRow, ShiftSnapshot } from '@/lib/pos/cash/types'
import type { PosBranch } from '@/lib/pos/types'
import { PrinterButton } from '../print/printer-button'
import type { CashApi } from './api'
import { CashScreen } from './cash-screen'

/**
 * La pantalla de caja enchufada al servidor: las lecturas y las acciones de
 * `lib/pos/cash/actions.ts`, atadas al bar de la URL. Cada acción vuelve a chequear quién sos y tu
 * rol; acá solo se les pone el `slug` adelante.
 */
export function CashLive({
  slug,
  initial,
  branch,
  branches,
  shifts,
  timeZone,
  account,
  barName,
  initialShiftId = null,
  payees = false,
  canLoadPurchases = false,
}: {
  slug: string
  initial: ShiftSnapshot
  branch: PosBranch
  branches: ReadonlyArray<PosBranch>
  shifts: ReadonlyArray<ShiftRow>
  timeZone: string
  account?: React.ReactNode
  /** El nombre del bar, para el membrete de lo que se imprime. */
  barName: string
  /** Un turno puntual para abrir de entrada (el link del mail de cierre). */
  initialShiftId?: string | null
  /** El bar usa Administración: al sacar plata se elige el proveedor o a quién del equipo. */
  payees?: boolean
  /** Quien está puede cargar compras en Administración: se le ofrece hacerlo al anotar el retiro. */
  canLoadPurchases?: boolean
}) {
  const api = useMemo<CashApi>(
    () => ({
      refresh: (branchId, options) => refreshShift(slug, branchId, options),
      open: (input) => openShift(slug, input),
      move: (input) => cashMovement(slug, input),
      targets: (branchId) => cashTargets(slug, branchId),
      voidMove: (movementId, why) => voidCashMovement(slug, movementId, why),
      close: (input) => closeShift(slug, input),
      checkCount: (shiftId, countedCents) =>
        checkShiftCount(slug, { branchId: branch.id, shiftId, countedCents }),
      checkOpening: (input) => checkOpeningCount(slug, { branchId: branch.id, ...input }),
      edit: (input) => editPayment(slug, input),
      voidPay: (paymentId, why) => voidPayment(slug, paymentId, why),
      setBranch: (branchId) => setActiveBranch(slug, branchId),
    }),
    [slug, branch.id],
  )
  // Administración › Compras, con el retiro ya elegido (`?caja=`): ahí se carga la compra o el pago.
  const purchaseHref = useCallback(
    (movementId: string) =>
      `/${slug}/administracion/compras?caja=${encodeURIComponent(movementId)}`,
    [slug],
  )
  return (
    // Otra sucursal es otra caja: la pantalla arranca de cero.
    <CashScreen
      key={branch.id}
      api={api}
      initial={initial}
      branch={branch}
      branches={branches}
      shifts={shifts}
      timeZone={timeZone}
      account={account}
      barName={barName}
      initialShiftId={initialShiftId}
      payees={payees}
      purchaseHref={canLoadPurchases ? purchaseHref : null}
      tools={
        <PrinterButton
          slug={slug}
          branchId={branch.id}
          branchName={branch.name}
          timeZone={timeZone}
        />
      }
    />
  )
}
