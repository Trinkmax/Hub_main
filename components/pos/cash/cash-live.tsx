'use client'

import { useMemo } from 'react'
import { setActiveBranch } from '@/lib/pos/actions'
import {
  cashMovement,
  closeShift,
  editPayment,
  openShift,
  refreshShift,
  voidCashMovement,
  voidPayment,
} from '@/lib/pos/cash/actions'
import type { ShiftRow, ShiftSnapshot } from '@/lib/pos/cash/types'
import type { PosBranch } from '@/lib/pos/types'
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
}: {
  slug: string
  initial: ShiftSnapshot
  branch: PosBranch
  branches: ReadonlyArray<PosBranch>
  shifts: ReadonlyArray<ShiftRow>
  timeZone: string
  account?: React.ReactNode
}) {
  const api = useMemo<CashApi>(
    () => ({
      refresh: (branchId, options) => refreshShift(slug, branchId, options),
      open: (input) => openShift(slug, input),
      move: (input) => cashMovement(slug, input),
      voidMove: (movementId, why) => voidCashMovement(slug, movementId, why),
      close: (input) => closeShift(slug, input),
      edit: (input) => editPayment(slug, input),
      voidPay: (paymentId, why) => voidPayment(slug, paymentId, why),
      setBranch: (branchId) => setActiveBranch(slug, branchId),
    }),
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
    />
  )
}
