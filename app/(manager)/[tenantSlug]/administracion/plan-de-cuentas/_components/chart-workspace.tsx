'use client'

import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { saveAccount } from '@/lib/accounting/actions/master'
import type { SystemAccountKey } from '@/lib/accounting/system-keys'
import { useMasterAction } from '../../ajustes/_components/use-master-action'
import { type ChartAccount, indexChart, initialExpanded } from '../_lib/tree'
import { AccountSheet, type AccountSheetState } from './account-sheet'
import { DeactivateDialog } from './deactivate-dialog'
import { MoveDialog } from './move-dialog'
import { RemapDialog } from './remap-dialog'
import { ChartWorkspaceContext, type ChartWorkspaceValue } from './workspace-context'

/** `?cuenta=` en la URL sin pedir la página de nuevo (la lista ya está acá). */
function syncCuentaParam(id: string | null) {
  try {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('cuenta', id)
    else url.searchParams.delete('cuenta')
    window.history.replaceState(window.history.state, '', url.toString())
  } catch {
    // Sin History API: la hoja funciona igual, solo no queda en la URL.
  }
}

/**
 * El plan de cuentas como espacio de trabajo: el índice del árbol, lo desplegado y la hoja y los
 * diálogos (editar, crear, mover, desactivar, cuentas del sistema), una sola vez para las dos
 * pestañas y el botón del encabezado.
 */
export function ChartWorkspace({
  tenantSlug,
  accounts,
  readOnly,
  canAdmin,
  balancesAvailable,
  initialAccountId,
  children,
}: {
  tenantSlug: string
  accounts: readonly ChartAccount[]
  readOnly: boolean
  canAdmin: boolean
  balancesAvailable: boolean
  initialAccountId: string | null
  children: ReactNode
}) {
  const index = useMemo(() => indexChart(accounts), [accounts])
  const { run } = useMasterAction()
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(index, initialAccountId),
  )
  const [sheet, setSheet] = useState<AccountSheetState>(() =>
    initialAccountId && index.byId.has(initialAccountId)
      ? { mode: 'account', id: initialAccountId }
      : null,
  )
  const [moving, setMoving] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [remapping, setRemapping] = useState<SystemAccountKey | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)

  const openAccount = useCallback((id: string) => {
    setSheet({ mode: 'account', id })
    syncCuentaParam(id)
  }, [])

  const closeSheet = useCallback(() => {
    setSheet(null)
    syncCuentaParam(null)
  }, [])

  const createAccount = useCallback(
    (parentId?: string | null) => {
      if (readOnly) return
      setSheet({ mode: 'create', parentId, nonce: Date.now() })
      syncCuentaParam(null)
    },
    [readOnly],
  )

  const moveAccount = useCallback(
    (id: string) => {
      if (readOnly) return
      setSheet(null)
      syncCuentaParam(null)
      setMoving(id)
    },
    [readOnly],
  )

  const changeActive = useCallback(
    (id: string, active: boolean) => {
      if (readOnly) return
      if (!active) {
        setSheet(null)
        syncCuentaParam(null)
        setDeactivating(id)
        return
      }
      const account = index.byId.get(id)
      if (!account) return
      run(
        () =>
          saveAccount(tenantSlug, {
            mode: 'update',
            id: account.id,
            expectedUpdatedAt: account.updatedAt,
            active: true,
          }),
        {
          quiet: true,
          onSuccess: (saved) => {
            toast.success(`Listo: ${saved.code} ${saved.name} volvió a estar activa.`)
            setFocusId(saved.id)
          },
        },
      )
    },
    [index, readOnly, run, tenantSlug],
  )

  const remapKey = useCallback(
    (key: SystemAccountKey) => {
      if (canAdmin) setRemapping(key)
    },
    [canAdmin],
  )

  const value: ChartWorkspaceValue = useMemo(
    () => ({
      tenantSlug,
      index,
      readOnly,
      canAdmin,
      balancesAvailable,
      expanded,
      setExpanded,
      focusId,
      clearFocus: () => setFocusId(null),
      openAccount,
      createAccount,
      moveAccount,
      changeActive,
      remapKey,
    }),
    [
      tenantSlug,
      index,
      readOnly,
      canAdmin,
      balancesAvailable,
      expanded,
      focusId,
      openAccount,
      createAccount,
      moveAccount,
      changeActive,
      remapKey,
    ],
  )

  return (
    <ChartWorkspaceContext.Provider value={value}>
      {children}
      <AccountSheet
        tenantSlug={tenantSlug}
        index={index}
        state={sheet}
        readOnly={readOnly}
        balancesAvailable={balancesAvailable}
        onClose={closeSheet}
        onSaved={(saved) => {
          closeSheet()
          setFocusId(saved.id)
        }}
        onMove={moveAccount}
        onChangeActive={changeActive}
      />
      {readOnly ? null : (
        <>
          <MoveDialog
            tenantSlug={tenantSlug}
            index={index}
            accountId={moving}
            onClose={() => setMoving(null)}
            onMoved={(saved, message) => {
              setMoving(null)
              toast.success(message)
              setFocusId(saved.id)
            }}
          />
          <DeactivateDialog
            tenantSlug={tenantSlug}
            index={index}
            balancesAvailable={balancesAvailable}
            accountId={deactivating}
            onClose={() => setDeactivating(null)}
            onDone={(saved, message) => {
              setDeactivating(null)
              toast.success(message)
              setFocusId(saved.id)
            }}
          />
        </>
      )}
      {canAdmin ? (
        <RemapDialog
          tenantSlug={tenantSlug}
          index={index}
          balancesAvailable={balancesAvailable}
          systemKey={remapping}
          onClose={() => setRemapping(null)}
          onDone={(result, message) => {
            setRemapping(null)
            toast.success(message)
            setFocusId(result.to.id)
          }}
        />
      ) : null}
    </ChartWorkspaceContext.Provider>
  )
}
